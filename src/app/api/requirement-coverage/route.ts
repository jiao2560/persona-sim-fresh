import { NextResponse } from 'next/server'
import { CohereClient } from 'cohere-ai'

// Initialize Cohere client
const cohere = new CohereClient({
  token: process.env.CO_API_KEY!
})

interface Message {
  id: string
  sender: 'student' | 'persona' | 'system'
  personaName?: string
  content: string
  timestamp: Date
  metadata?: Record<string, any>
}

interface RequirementCoverageRequest {
  messages: Message[]
  projectRequirements: string[] // List of actual requirements for the project
  studentName: string
  sessionId: string
  generateReport?: boolean // Flag to generate detailed report
}

interface QuestionQuality {
  question: string
  score: number // 1-5
  explanation: string
}

interface RequirementAnalysis {
  requirement: string
  covered: boolean
  evidence: string[] // Quotes from transcript that cover this requirement
  coverageScore: number // 0-1 score for how well it was covered
}

interface CoverageResponse {
  studentName: string
  sessionId: string
  overallCoverageRate: number // Percentage of requirements covered
  requirementAnalyses: RequirementAnalysis[]
  questionQualityScore: number // Average quality score of questions (1-5)
  questionAnalyses: QuestionQuality[]
  strengths: string[] // What the student did well
  improvements: string[] // Areas for improvement
  analyzedAt: Date
  detailedAnalysis?: string // Detailed report for instructors
}

export async function POST(req: Request) {
  try {
    const { messages, projectRequirements, studentName, sessionId, generateReport }: RequirementCoverageRequest = await req.json()

    if (!messages || !projectRequirements || projectRequirements.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    console.log('=== REQUIREMENT COVERAGE ANALYSIS ===')
    console.log('Student:', studentName)
    console.log('Total requirements:', projectRequirements.length)
    console.log('Total messages:', messages.length)
    console.log('Project requirements:', projectRequirements)

    // Extract student questions only
    const studentQuestions = messages
      .filter(msg => msg.sender === 'student')
      .map(msg => msg.content)

    console.log('Student questions count:', studentQuestions.length)

    // Step 1: Evaluate question quality
    const questionAnalyses = await evaluateQuestionQuality(studentQuestions, projectRequirements)
    const avgQuestionScore = questionAnalyses.length > 0
      ? questionAnalyses.reduce((sum, q) => sum + q.score, 0) / questionAnalyses.length
      : 1 // Default to very low if no questions

    // Step 2: Evaluate requirement coverage
    const requirementAnalyses = await evaluateRequirementCoverage(
      projectRequirements,
      messages,
      questionAnalyses
    )

    // Calculate overall coverage - using strict evaluation
    const coveredRequirements = requirementAnalyses.filter(r => r.covered).length
    const overallCoverageRate = (coveredRequirements / projectRequirements.length) * 100

    // Adjust coverage based on question quality
    const qualityPenalty = avgQuestionScore < 3 ? 0.7 : avgQuestionScore < 4 ? 0.85 : 1.0
    const adjustedCoverageRate = overallCoverageRate * qualityPenalty

    console.log('Raw coverage rate:', overallCoverageRate)
    console.log('Average question quality:', avgQuestionScore)
    console.log('Quality penalty multiplier:', qualityPenalty)
    console.log('Adjusted coverage rate:', adjustedCoverageRate)

    // Generate strengths and improvements
    const { strengths, improvements } = generateFeedback(
      requirementAnalyses,
      questionAnalyses,
      adjustedCoverageRate
    )

    // Generate detailed analysis if requested
    let detailedAnalysis: string | undefined
    if (generateReport) {
      detailedAnalysis = generateDetailedReport(
        studentName,
        sessionId,
        adjustedCoverageRate,
        requirementAnalyses,
        questionAnalyses,
        strengths,
        improvements,
        messages
      )
    }

    const response: CoverageResponse = {
      studentName,
      sessionId,
      overallCoverageRate: adjustedCoverageRate,
      requirementAnalyses,
      questionQualityScore: avgQuestionScore,
      questionAnalyses,
      strengths,
      improvements,
      analyzedAt: new Date(),
      detailedAnalysis
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Coverage analysis error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze requirement coverage' },
      { status: 500 }
    )
  }
}

async function evaluateQuestionQuality(
  questions: string[],
  projectRequirements: string[]
): Promise<QuestionQuality[]> {
  const analyses: QuestionQuality[] = []

  // Create context about the project from requirements
  const projectContext = projectRequirements.join('\n')

  for (const question of questions) {
    try {
      const prompt = `You are an expert requirements engineering instructor evaluating student interview questions.

PROJECT REQUIREMENTS CONTEXT:
${projectContext}

STUDENT QUESTION: "${question}"

Evaluate this question on a scale of 1-5:
1 = Very Poor (casual, unprofessional, or completely off-topic like "howdy dude lol")
2 = Poor (too vague, lazy questions like "give me requirements" or "what do you need?")
3 = Fair (somewhat relevant but lacks depth or specificity)
4 = Good (professional, specific, targets actual requirements)
5 = Excellent (insightful, probing, elicits detailed requirements)

IMPORTANT CRITERIA:
- Questions asking directly for requirements (e.g., "give me requirements", "what are your requirements") should score 2 or lower
- Casual/unprofessional language scores 1
- Questions must demonstrate effort to understand stakeholder needs, not just ask for a list
- Good questions explore WHY, HOW, WHEN, WHO aspects
- Excellent questions probe edge cases, constraints, priorities

FORMAT YOUR RESPONSE EXACTLY AS:
SCORE: [1-5]
EXPLANATION: [One sentence explaining the score]

Example responses:
SCORE: 1
EXPLANATION: Unprofessional greeting with no relevance to requirements elicitation.

SCORE: 2
EXPLANATION: Lazy question asking directly for requirements without understanding context.

SCORE: 4
EXPLANATION: Specific question about user workflow that helps uncover functional requirements.`

      const response = await cohere.chat({
        model: 'command-r-plus',
        message: prompt,
        maxTokens: 100,
        temperature: 0.3,
      })

      const responseText = response.text?.trim() || ''
      console.log(`Question "${question}" evaluation:`, responseText)

      // Parse response
      const scoreMatch = responseText.match(/SCORE:\s*(\d)/i)
      const explanationMatch = responseText.match(/EXPLANATION:\s*(.+)/i)

      const score = scoreMatch ? parseInt(scoreMatch[1]) : 2
      const explanation = explanationMatch ? explanationMatch[1].trim() : 'Unable to evaluate'

      analyses.push({
        question,
        score: Math.max(1, Math.min(5, score)), // Ensure 1-5 range
        explanation
      })

    } catch (error) {
      console.error('Error evaluating question:', error)
      analyses.push({
        question,
        score: 2,
        explanation: 'Error during evaluation'
      })
    }
  }

  return analyses
}

// Define type for evaluation response
interface RequirementEvaluation {
  requirementNumber: number
  covered: boolean
  evidence: string[]
  confidence: number
}

async function evaluateRequirementCoverage(
  requirements: string[],
  messages: Message[],
  questionQuality: QuestionQuality[]
): Promise<RequirementAnalysis[]> {
  const analyses: RequirementAnalysis[] = []

  // Build conversation transcript
  const transcript = messages
    .map(msg => `${msg.sender === 'student' ? 'Student' : msg.personaName || 'Persona'}: ${msg.content}`)
    .join('\n\n')

  // Get average question quality for this evaluation
  const avgQuality = questionQuality.length > 0
    ? questionQuality.reduce((sum, q) => sum + q.score, 0) / questionQuality.length
    : 2

  // Create a single evaluation call for all requirements (more efficient)
  try {
    const requirementsList = requirements
      .map((req, index) => `Requirement ${index + 1}: ${req}`)
      .join('\n')

    const prompt = `You are evaluating a requirements elicitation interview to determine which requirements were successfully uncovered.

COMPLETE LIST OF PROJECT REQUIREMENTS:
${requirementsList}

INTERVIEW TRANSCRIPT:
${transcript}

STUDENT QUESTION QUALITY: ${avgQuality.toFixed(1)}/5
${avgQuality < 3 ? 'Note: Low quality questions detected - be extra strict in evaluation.' : ''}

For each requirement, determine if it was covered in the conversation. A requirement is only "covered" if:
1. The student asked relevant questions about it (not just "what are your requirements")
2. The persona provided information about it in response to good questions
3. There is clear evidence in the transcript

${avgQuality < 3 ? 'IMPORTANT: Due to low question quality, only mark requirements as covered if there is VERY clear evidence.' : ''}

Return a JSON array with one object per requirement:
[
  {
    "requirementNumber": 1,
    "covered": true/false,
    "evidence": ["quote from transcript"] or [],
    "confidence": 0.0-1.0
  }
]

Only include actual quotes as evidence. If not covered, evidence should be empty array.`

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens: 2000,
      temperature: 0.2,
    })

    const responseText = response.text?.trim() || '[]'
    console.log('Coverage evaluation response:', responseText.substring(0, 500))

    // Parse JSON response
    let evaluations: RequirementEvaluation[] = []
    try {
      // Extract JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        evaluations = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse coverage JSON:', parseError)
      evaluations = []
    }

    // Map evaluations to requirements
    requirements.forEach((req, index) => {
      const evaluation = evaluations.find((e: RequirementEvaluation) => e.requirementNumber === index + 1)

      if (evaluation) {
        analyses.push({
          requirement: req,
          covered: evaluation.covered || false,
          evidence: Array.isArray(evaluation.evidence) ? evaluation.evidence : [],
          coverageScore: evaluation.covered ? (evaluation.confidence || 0.8) : 0
        })
      } else {
        // Default to not covered
        analyses.push({
          requirement: req,
          covered: false,
          evidence: [],
          coverageScore: 0
        })
      }
    })

  } catch (error) {
    console.error('Error evaluating requirements:', error)
    // Return all requirements as not covered on error
    requirements.forEach(req => {
      analyses.push({
        requirement: req,
        covered: false,
        evidence: [],
        coverageScore: 0
      })
    })
  }

  return analyses
}

function generateFeedback(
  requirementAnalyses: RequirementAnalysis[],
  questionAnalyses: QuestionQuality[],
  overallCoverage: number
): { strengths: string[]; improvements: string[] } {
  const strengths: string[] = []
  const improvements: string[] = []

  // Analyze question quality
  const excellentQuestions = questionAnalyses.filter(q => q.score >= 4)
  const poorQuestions = questionAnalyses.filter(q => q.score <= 2)
  const avgQuestionScore = questionAnalyses.length > 0
    ? questionAnalyses.reduce((sum, q) => sum + q.score, 0) / questionAnalyses.length
    : 0

  // Analyze requirement coverage
  const coveredReqs = requirementAnalyses.filter(r => r.covered)
  const missedReqs = requirementAnalyses.filter(r => !r.covered)

  // Generate strengths
  if (excellentQuestions.length > 0) {
    strengths.push(`Asked ${excellentQuestions.length} high-quality questions that effectively explored requirements`)
  }
  if (coveredReqs.length >= requirementAnalyses.length * 0.6) {
    strengths.push(`Successfully elicited ${coveredReqs.length} out of ${requirementAnalyses.length} requirements`)
  }
  if (avgQuestionScore >= 3.5) {
    strengths.push(`Maintained professional communication with average question quality of ${avgQuestionScore.toFixed(1)}/5`)
  }

  // Generate improvements
  if (poorQuestions.length > 0) {
    improvements.push(`Avoid low-quality questions - ${poorQuestions.length} questions scored 2 or below`)
    if (poorQuestions.some(q => q.explanation.includes('requirements'))) {
      improvements.push(`Don't ask directly for requirements - explore needs through specific questions`)
    }
  }
  if (missedReqs.length > 0) {
    const topMissed = missedReqs.slice(0, 2).map(r => r.requirement.substring(0, 50) + '...')
    improvements.push(`Missed ${missedReqs.length} requirements including: ${topMissed.join('; ')}`)
  }
  if (avgQuestionScore < 3) {
    improvements.push(`Improve question quality - current average is only ${avgQuestionScore.toFixed(1)}/5`)
  }
  if (questionAnalyses.length < 5) {
    improvements.push(`Ask more questions - only ${questionAnalyses.length} questions asked`)
  }

  // Ensure we always have feedback
  if (strengths.length === 0) {
    strengths.push('Completed the interview session')
  }
  if (improvements.length === 0) {
    improvements.push('Continue practicing requirements elicitation techniques')
  }

  return { strengths, improvements }
}

function generateDetailedReport(
  studentName: string,
  sessionId: string,
  overallCoverage: number,
  requirementAnalyses: RequirementAnalysis[],
  questionAnalyses: QuestionQuality[],
  strengths: string[],
  improvements: string[],
  messages: Message[]
): string {
  const coveredReqs = requirementAnalyses.filter(r => r.covered)
  const missedReqs = requirementAnalyses.filter(r => !r.covered)
  const avgQuestionScore = questionAnalyses.length > 0
    ? questionAnalyses.reduce((sum, q) => sum + q.score, 0) / questionAnalyses.length
    : 0

  const studentQuestions = messages.filter(m => m.sender === 'student').length
  const excellentQuestions = questionAnalyses.filter(q => q.score >= 4).length
  const poorQuestions = questionAnalyses.filter(q => q.score <= 2).length

  // Calculate grade based on coverage AND question quality
  const gradeInfo = overallCoverage >= 80 && avgQuestionScore >= 4 ? { grade: 'A', desc: 'Excellent' } :
                   overallCoverage >= 70 && avgQuestionScore >= 3.5 ? { grade: 'B', desc: 'Good' } :
                   overallCoverage >= 60 && avgQuestionScore >= 3 ? { grade: 'C', desc: 'Satisfactory' } :
                   overallCoverage >= 50 && avgQuestionScore >= 2.5 ? { grade: 'D', desc: 'Needs Improvement' } :
                   { grade: 'F', desc: 'Insufficient' }

  let report = `# Requirements Coverage Analysis Report\n\n`
  report += `**Student:** ${studentName}\n`
  report += `**Session ID:** ${sessionId}\n`
  report += `**Date:** ${new Date().toLocaleDateString()}\n`
  report += `**Time:** ${new Date().toLocaleTimeString()}\n\n`

  report += `## Executive Summary\n\n`
  report += `The student achieved an overall requirements coverage of **${overallCoverage.toFixed(1)}%** with an average question quality score of **${avgQuestionScore.toFixed(1)}/5**. `
  report += `They successfully elicited ${coveredReqs.length} out of ${requirementAnalyses.length} project requirements through ${studentQuestions} questions.\n\n`

  report += `## Performance Metrics\n\n`
  report += `| Metric | Value |\n`
  report += `|--------|-------|\n`
  report += `| Overall Coverage Rate | ${overallCoverage.toFixed(1)}% |\n`
  report += `| Question Quality Score | ${avgQuestionScore.toFixed(1)}/5 |\n`
  report += `| Total Questions Asked | ${studentQuestions} |\n`
  report += `| Excellent Questions (4-5) | ${excellentQuestions} |\n`
  report += `| Poor Questions (1-2) | ${poorQuestions} |\n`
  report += `| Requirements Covered | ${coveredReqs.length}/${requirementAnalyses.length} |\n\n`

  report += `## Grade Assessment\n\n`
  report += `**Grade: ${gradeInfo.grade} (${gradeInfo.desc})**\n\n`
  report += `Based on ${overallCoverage.toFixed(1)}% coverage and ${avgQuestionScore.toFixed(1)}/5 question quality.\n\n`

  report += `## Question Quality Analysis\n\n`

  if (poorQuestions > 0) {
    report += `### Poor Quality Questions (Score 1-2)\n\n`
    questionAnalyses
      .filter(q => q.score <= 2)
      .slice(0, 3)
      .forEach(q => {
        report += `**"${q.question}"** (Score: ${q.score}/5)\n`
        report += `- ${q.explanation}\n\n`
      })
  }

  if (excellentQuestions > 0) {
    report += `### Excellent Questions (Score 4-5)\n\n`
    questionAnalyses
      .filter(q => q.score >= 4)
      .slice(0, 3)
      .forEach(q => {
        report += `**"${q.question}"** (Score: ${q.score}/5)\n`
        report += `- ${q.explanation}\n\n`
      })
  }

  report += `## Requirement Coverage Details\n\n`

  if (coveredReqs.length > 0) {
    report += `### Successfully Covered Requirements\n\n`
    coveredReqs.slice(0, 5).forEach(req => {
      report += `✅ **${req.requirement}**\n`
      if (req.evidence.length > 0) {
        report += `   Evidence: "${req.evidence[0].substring(0, 100)}..."\n`
      }
      report += `\n`
    })
  }

  if (missedReqs.length > 0) {
    report += `### Missed Requirements\n\n`
    report += `The following requirements were not adequately covered:\n\n`
    missedReqs.slice(0, 10).forEach(req => {
      report += `❌ ${req.requirement}\n`
    })
    report += `\n`
  }

  report += `## Strengths\n\n`
  strengths.forEach(s => {
    report += `- ${s}\n`
  })
  report += `\n`

  report += `## Areas for Improvement\n\n`
  improvements.forEach(i => {
    report += `- ${i}\n`
  })
  report += `\n`

  report += `## Recommendations\n\n`
  report += `1. **Question Quality**: `
  if (avgQuestionScore < 3) {
    report += `Focus on asking specific, professional questions that explore the 'why' and 'how' behind requirements.\n`
  } else {
    report += `Continue asking thoughtful questions but aim for more depth.\n`
  }

  report += `2. **Coverage Strategy**: `
  if (missedReqs.length > requirementAnalyses.length * 0.4) {
    report += `Create a mental checklist of requirement areas to ensure comprehensive coverage.\n`
  } else {
    report += `Good coverage overall - focus on the few missed areas.\n`
  }

  report += `3. **Interview Technique**: Avoid asking directly for requirements. Instead, explore user workflows, pain points, and goals.\n`

  return report
}

// GET endpoint to retrieve coverage analysis for a session
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      message: 'Coverage analysis not yet generated for this session',
      sessionId
    })

  } catch (error) {
    console.error('Error retrieving coverage analysis:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve coverage analysis' },
      { status: 500 }
    )
  }
}