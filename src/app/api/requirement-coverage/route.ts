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
    console.log('Generate report:', generateReport)
    console.log('Project requirements:', projectRequirements) // Debug log

    // Extract only student questions and persona responses
    const interviewTranscript = messages
      .filter(msg => msg.sender !== 'system')
      .map(msg => `${msg.sender === 'student' ? 'Student' : msg.personaName || 'Persona'}: ${msg.content}`)
      .join('\n\n')

    console.log('Transcript sample:', interviewTranscript.substring(0, 500)) // Debug log

    // Analyze each requirement
    const requirementAnalyses: RequirementAnalysis[] = []

    for (const requirement of projectRequirements) {
      console.log('Analyzing requirement:', requirement) // Debug log
      const analysis = await analyzeRequirementCoverage(requirement, interviewTranscript)
      console.log('Analysis result:', analysis) // Debug log
      requirementAnalyses.push(analysis)
    }

    // Calculate overall coverage - using weighted average based on coverage scores
    const totalScore = requirementAnalyses.reduce((sum, r) => sum + r.coverageScore, 0)
    const maxPossibleScore = projectRequirements.length // Each requirement can score max 1.0
    const overallCoverageRate = (totalScore / maxPossibleScore) * 100

    console.log('Total score:', totalScore)
    console.log('Max possible score:', maxPossibleScore)
    console.log('Overall coverage rate:', overallCoverageRate)

    // Generate strengths and improvements
    const { strengths, improvements } = await generateFeedback(
      interviewTranscript,
      requirementAnalyses,
      overallCoverageRate
    )

    // Generate detailed analysis if requested
    let detailedAnalysis: string | undefined
    if (generateReport) {
      detailedAnalysis = await generateDetailedReport(
        studentName,
        sessionId,
        overallCoverageRate,
        requirementAnalyses,
        strengths,
        improvements,
        messages
      )
    }

    const response: CoverageResponse = {
      studentName,
      sessionId,
      overallCoverageRate,
      requirementAnalyses,
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

async function analyzeRequirementCoverage(
  requirement: string,
  transcript: string
): Promise<RequirementAnalysis> {
  try {
    // More specific prompt to avoid bias
    const prompt = `You are analyzing a requirements elicitation interview transcript to determine if a specific requirement was discussed.

REQUIREMENT TO CHECK: "${requirement}"

INTERVIEW TRANSCRIPT:
${transcript.substring(0, 4000)} // Limit context to avoid token limits

ANALYSIS INSTRUCTIONS:
1. Look for ANY mention or discussion related to this requirement
2. Consider both direct and indirect references
3. Check if the student asked questions that would elicit this requirement
4. Look for persona responses that relate to this requirement

SCORING GUIDELINES:
- 0: Not mentioned at all, no related questions asked
- 0.2: Vaguely related topic mentioned but requirement not addressed
- 0.4: Requirement area touched but not specifically elicited
- 0.6: Requirement partially discussed with some relevant details
- 0.8: Requirement well covered with good follow-up questions
- 1.0: Requirement thoroughly explored with comprehensive detail

IMPORTANT: Be strict in your evaluation. Only mark as covered if the requirement was actually discussed, not just if related topics were mentioned.

FORMAT YOUR RESPONSE EXACTLY AS:
COVERED: [yes/no]
SCORE: [0-1]
EVIDENCE:
- "Exact quote from transcript" (or "none" if not covered)
- "Another quote if applicable"

Example of NOT covered:
COVERED: no
SCORE: 0
EVIDENCE:
- none

Example of partially covered:
COVERED: yes
SCORE: 0.6
EVIDENCE:
- "Student: What kind of reporting features do you need?"
- "Persona: We need daily sales reports"`

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens: 300,
      temperature: 0.2, // Lower temperature for more consistent analysis
    })

    const analysisText = response.text?.trim() || ''
    console.log('Cohere response for requirement:', requirement, '\n', analysisText) // Debug log

    // Parse the response with better error handling
    const coveredMatch = analysisText.match(/COVERED:\s*(yes|no)/i)
    const scoreMatch = analysisText.match(/SCORE:\s*([\d.]+)/)
    const evidenceMatch = analysisText.match(/EVIDENCE:\s*([\s\S]*)/i)

    const covered = coveredMatch?.[1]?.toLowerCase() === 'yes'
    const coverageScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0

    // Ensure consistency between covered and score
    if (!covered && coverageScore > 0) {
      console.warn('Inconsistency detected: not covered but score > 0')
      return {
        requirement,
        covered: false,
        evidence: [],
        coverageScore: 0
      }
    }

    let evidence: string[] = []
    if (evidenceMatch && evidenceMatch[1].trim().toLowerCase() !== 'none') {
      evidence = evidenceMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.replace(/^-\s*"?|"?$/g, '').trim())
        .filter(quote => quote.length > 0 && quote.toLowerCase() !== 'none')
        .slice(0, 3) // Maximum 3 quotes
    }

    return {
      requirement,
      covered,
      evidence,
      coverageScore
    }

  } catch (error) {
    console.error('Error analyzing requirement:', error)
    return {
      requirement,
      covered: false,
      evidence: [],
      coverageScore: 0
    }
  }
}

async function generateFeedback(
  transcript: string,
  analyses: RequirementAnalysis[],
  overallCoverage: number
): Promise<{ strengths: string[]; improvements: string[] }> {
  try {
    const coveredReqs = analyses.filter(a => a.covered).map(a => a.requirement)
    const missedReqs = analyses.filter(a => !a.covered).map(a => a.requirement)
    const partialReqs = analyses.filter(a => a.coverageScore > 0 && a.coverageScore < 0.6).map(a => a.requirement)
    const wellCoveredReqs = analyses.filter(a => a.coverageScore >= 0.8).map(a => a.requirement)

    const prompt = `Based on this requirements elicitation interview analysis, provide specific and actionable feedback for the student.

OVERALL COVERAGE: ${overallCoverage.toFixed(1)}%
TOTAL REQUIREMENTS: ${analyses.length}

WELL COVERED REQUIREMENTS (score >= 0.8): ${wellCoveredReqs.length}
${wellCoveredReqs.slice(0, 3).map(r => `- ${r}`).join('\n')}

PARTIALLY COVERED (0.2 < score < 0.6): ${partialReqs.length}
${partialReqs.slice(0, 3).map(r => `- ${r}`).join('\n')}

MISSED REQUIREMENTS (score = 0): ${missedReqs.length}
${missedReqs.slice(0, 3).map(r => `- ${r}`).join('\n')}

Based on this analysis, provide:
1. 2-3 SPECIFIC strengths about what the student did well (be concrete, mention actual techniques used)
2. 2-3 SPECIFIC areas for improvement (be actionable, suggest concrete techniques)

Do NOT use generic feedback. Reference the actual performance data.

FORMAT:
STRENGTHS:
- [Specific strength with example]
- [Another specific strength]

IMPROVEMENTS:
- [Specific actionable improvement]
- [Another specific improvement]`

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens: 400,
      temperature: 0.5,
    })

    const feedbackText = response.text?.trim() || ''

    // Parse strengths and improvements
    const strengthsMatch = feedbackText.match(/STRENGTHS:\s*([\s\S]*?)(?=IMPROVEMENTS:|$)/i)
    const improvementsMatch = feedbackText.match(/IMPROVEMENTS:\s*([\s\S]*)/i)

    const parsePoints = (text: string): string[] => {
      return text
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(point => point.length > 0)
        .slice(0, 3)
    }

    const strengths = strengthsMatch ? parsePoints(strengthsMatch[1]) :
      [`Completed the interview with ${overallCoverage.toFixed(1)}% coverage`]

    const improvements = improvementsMatch ? parsePoints(improvementsMatch[1]) :
      missedReqs.length > 0 ?
        [`Focus on eliciting requirements about: ${missedReqs[0]}`, 'Ask more follow-up questions'] :
        ['Explore requirements in greater depth', 'Ask more probing questions']

    return { strengths, improvements }

  } catch (error) {
    console.error('Error generating feedback:', error)
    return {
      strengths: ['Engaged with personas effectively'],
      improvements: ['Explore requirements in more detail', 'Ask more follow-up questions']
    }
  }
}

async function generateDetailedReport(
  studentName: string,
  sessionId: string,
  overallCoverage: number,
  analyses: RequirementAnalysis[],
  strengths: string[],
  improvements: string[],
  messages: Message[]
): Promise<string> {
  try {
    const coveredReqs = analyses.filter(a => a.covered)
    const missedReqs = analyses.filter(a => !a.covered)
    const partialReqs = analyses.filter(a => a.coverageScore > 0 && a.coverageScore < 0.6)
    const wellCoveredReqs = analyses.filter(a => a.coverageScore >= 0.8)

    // Calculate additional metrics
    const avgCoverageScore = analyses.length > 0
      ? analyses.reduce((sum, r) => sum + r.coverageScore, 0) / analyses.length
      : 0

    const studentQuestions = messages.filter(m => m.sender === 'student').length
    const personaResponses = messages.filter(m => m.sender === 'persona').length

    // Calculate grade based on coverage
    const gradeInfo = overallCoverage >= 85 ? { grade: 'A', desc: 'Excellent' } :
                     overallCoverage >= 75 ? { grade: 'B', desc: 'Good' } :
                     overallCoverage >= 65 ? { grade: 'C', desc: 'Satisfactory' } :
                     overallCoverage >= 55 ? { grade: 'D', desc: 'Needs Improvement' } :
                     { grade: 'F', desc: 'Insufficient' }

    let report = `# Requirements Coverage Analysis Report\n\n`
    report += `**Student:** ${studentName}\n`
    report += `**Session ID:** ${sessionId}\n`
    report += `**Date:** ${new Date().toLocaleDateString()}\n`
    report += `**Time:** ${new Date().toLocaleTimeString()}\n\n`

    report += `## Executive Summary\n\n`
    report += `The student achieved an overall requirements coverage of **${overallCoverage.toFixed(1)}%**, `
    report += `successfully eliciting ${coveredReqs.length} out of ${analyses.length} project requirements. `
    report += `The interview consisted of ${studentQuestions} student questions and ${personaResponses} persona responses.\n\n`

    report += `## Performance Metrics\n\n`
    report += `| Metric | Value |\n`
    report += `|--------|-------|\n`
    report += `| Overall Coverage Rate | ${overallCoverage.toFixed(1)}% |\n`
    report += `| Average Coverage Quality | ${(avgCoverageScore * 100).toFixed(1)}% |\n`
    report += `| Requirements Well-Covered (≥80%) | ${wellCoveredReqs.length} |\n`
    report += `| Requirements Partially Covered | ${partialReqs.length} |\n`
    report += `| Requirements Missed | ${missedReqs.length} |\n`
    report += `| Total Student Questions | ${studentQuestions} |\n`
    report += `| Questions per Requirement | ${(studentQuestions / analyses.length).toFixed(1)} |\n\n`

    report += `## Grade Assessment\n\n`
    report += `**Grade: ${gradeInfo.grade} (${gradeInfo.desc})**\n\n`
    report += `Based on ${overallCoverage.toFixed(1)}% coverage and interview quality.\n\n`

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

    report += `## Detailed Requirement Breakdown\n\n`

    if (wellCoveredReqs.length > 0) {
      report += `### Excellent Coverage (≥80%)\n\n`
      analyses
        .filter(a => a.coverageScore >= 0.8)
        .sort((a, b) => b.coverageScore - a.coverageScore)
        .slice(0, 5)
        .forEach(req => {
          report += `**${req.requirement}** (${(req.coverageScore * 100).toFixed(0)}%)\n`
          if (req.evidence.length > 0) {
            report += `- Evidence: "${req.evidence[0].substring(0, 100)}..."\n`
          }
          report += `\n`
        })
    }

    if (partialReqs.length > 0) {
      report += `### Partial Coverage (20-60%)\n\n`
      analyses
        .filter(a => a.coverageScore > 0.2 && a.coverageScore < 0.6)
        .slice(0, 5)
        .forEach(req => {
          report += `**${req.requirement}** (${(req.coverageScore * 100).toFixed(0)}%)\n`
          report += `- Recommendation: Ask more specific follow-up questions about this requirement\n\n`
        })
    }

    if (missedReqs.length > 0) {
      report += `### Missed Requirements\n\n`
      report += `The following requirements were not addressed during the interview:\n\n`
      missedReqs.slice(0, 10).forEach(req => {
        report += `- ${req.requirement}\n`
      })
      report += `\n`
    }

    report += `## Recommendations for Next Interview\n\n`
    report += `1. **Pre-interview Planning**: Review all requirements before starting and create a checklist\n`
    report += `2. **Systematic Approach**: Address each requirement area methodically\n`
    report += `3. **Follow-up Questions**: When a requirement area is mentioned, dig deeper with "why", "how", and "what if" questions\n`
    report += `4. **Time Management**: Allocate time proportionally to ensure all requirements are covered\n`

    if (missedReqs.length > 3) {
      report += `5. **Priority Focus**: In your next interview, prioritize these missed areas: ${missedReqs.slice(0, 3).map(r => r.requirement).join(', ')}\n`
    }

    return report

  } catch (error) {
    console.error('Error generating detailed report:', error)
    return 'Unable to generate detailed report due to an error.'
  }
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

    // In production, you would store and retrieve the analysis from a database
    // For now, return a message indicating the analysis needs to be generated
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