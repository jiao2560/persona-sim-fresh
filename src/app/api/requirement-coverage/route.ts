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

    // Extract only student questions and persona responses
    const interviewTranscript = messages
      .filter(msg => msg.sender !== 'system')
      .map(msg => `${msg.sender === 'student' ? 'Student' : msg.personaName}: ${msg.content}`)
      .join('\n\n')

    // Analyze each requirement
    const requirementAnalyses: RequirementAnalysis[] = []

    for (const requirement of projectRequirements) {
      const analysis = await analyzeRequirementCoverage(requirement, interviewTranscript)
      requirementAnalyses.push(analysis)
    }

    // Calculate overall coverage
    const coveredRequirements = requirementAnalyses.filter(r => r.covered).length
    const overallCoverageRate = (coveredRequirements / projectRequirements.length) * 100

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
    const prompt = `Analyze if this requirement was adequately covered in the interview transcript.

REQUIREMENT: "${requirement}"

INTERVIEW TRANSCRIPT:
${transcript.substring(0, 4000)} // Limit context to avoid token limits

TASK:
1. Determine if this requirement was discussed or elicited during the interview
2. Find specific quotes from the transcript that relate to this requirement
3. Rate how well it was covered on a scale of 0 to 1
   - 0: Not mentioned at all
   - 0.3: Briefly touched upon but not explored
   - 0.6: Discussed with some detail
   - 0.8: Well covered with good detail
   - 1.0: Thoroughly explored with comprehensive detail

FORMAT YOUR RESPONSE AS:
COVERED: [yes/no]
SCORE: [0-1]
EVIDENCE:
- "Quote 1 from transcript"
- "Quote 2 from transcript"
(Maximum 3 quotes)

If not covered, write:
COVERED: no
SCORE: 0
EVIDENCE: none`

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens: 300,
      temperature: 0.3, // Low temperature for consistent analysis
    })

    const analysisText = response.text?.trim() || ''

    // Parse the response
    const coveredMatch = analysisText.match(/COVERED:\s*(yes|no)/i)
    const scoreMatch = analysisText.match(/SCORE:\s*([\d.]+)/)
    const evidenceMatch = analysisText.match(/EVIDENCE:\s*([\s\S]*)/i)

    const covered = coveredMatch?.[1]?.toLowerCase() === 'yes'
    const coverageScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0

    let evidence: string[] = []
    if (evidenceMatch && evidenceMatch[1].trim() !== 'none') {
      evidence = evidenceMatch[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.replace(/^-\s*"?|"?$/g, '').trim())
        .filter(quote => quote.length > 0)
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

    const prompt = `Based on this requirements elicitation interview analysis, provide feedback for the student.

OVERALL COVERAGE: ${overallCoverage.toFixed(1)}%

COVERED REQUIREMENTS (${coveredReqs.length}):
${coveredReqs.slice(0, 5).join('\n')}

MISSED REQUIREMENTS (${missedReqs.length}):
${missedReqs.slice(0, 5).join('\n')}

PARTIALLY COVERED (${partialReqs.length}):
${partialReqs.slice(0, 5).join('\n')}

Provide:
1. 2-3 specific strengths about their interview technique
2. 2-3 specific areas for improvement

FORMAT:
STRENGTHS:
- [Specific strength 1]
- [Specific strength 2]

IMPROVEMENTS:
- [Specific improvement 1]
- [Specific improvement 2]`

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

    const strengths = strengthsMatch ? parsePoints(strengthsMatch[1]) : ['Good effort in conducting the interview']
    const improvements = improvementsMatch ? parsePoints(improvementsMatch[1]) : ['Focus on exploring requirements in more detail']

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

    // Calculate additional metrics
    const avgCoverageScore = coveredReqs.length > 0
      ? coveredReqs.reduce((sum, r) => sum + r.coverageScore, 0) / coveredReqs.length
      : 0

    const studentQuestions = messages.filter(m => m.sender === 'student').length
    const personaResponses = messages.filter(m => m.sender === 'persona').length

    const prompt = `Generate a comprehensive instructor report for this requirements elicitation interview session.

STUDENT: ${studentName}
SESSION: ${sessionId}
OVERALL COVERAGE: ${overallCoverage.toFixed(1)}%
AVERAGE COVERAGE QUALITY: ${(avgCoverageScore * 100).toFixed(1)}%
TOTAL REQUIREMENTS: ${analyses.length}
COVERED: ${coveredReqs.length}
MISSED: ${missedReqs.length}
PARTIALLY COVERED: ${partialReqs.length}
STUDENT QUESTIONS: ${studentQuestions}
PERSONA RESPONSES: ${personaResponses}

STRENGTHS:
${strengths.map(s => `- ${s}`).join('\n')}

IMPROVEMENTS:
${improvements.map(i => `- ${i}`).join('\n')}

Generate a detailed report that includes:
1. Executive summary of the student's performance
2. Analysis of interview technique and question quality
3. Specific examples of good and poor elicitation practices
4. Recommendations for skill development
5. Grade recommendation based on coverage and technique

Format the report in a professional, constructive tone suitable for instructor review.`

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens: 800,
      temperature: 0.6,
    })

    const report = response.text?.trim() || 'Unable to generate detailed report.'

    // Add requirement details to the report
    let enhancedReport = `# Requirements Coverage Analysis Report\n\n`
    enhancedReport += `**Student:** ${studentName}\n`
    enhancedReport += `**Session ID:** ${sessionId}\n`
    enhancedReport += `**Date:** ${new Date().toLocaleDateString()}\n\n`
    enhancedReport += `## Performance Metrics\n`
    enhancedReport += `- **Overall Coverage Rate:** ${overallCoverage.toFixed(1)}%\n`
    enhancedReport += `- **Average Coverage Quality:** ${(avgCoverageScore * 100).toFixed(1)}%\n`
    enhancedReport += `- **Requirements Covered:** ${coveredReqs.length}/${analyses.length}\n`
    enhancedReport += `- **Student Questions:** ${studentQuestions}\n`
    enhancedReport += `- **Interview Length:** ${messages.length} total messages\n\n`

    enhancedReport += report + '\n\n'

    enhancedReport += `## Detailed Requirement Breakdown\n\n`

    if (coveredReqs.length > 0) {
      enhancedReport += `### Well-Covered Requirements\n`
      coveredReqs
        .sort((a, b) => b.coverageScore - a.coverageScore)
        .slice(0, 5)
        .forEach(req => {
          enhancedReport += `- **${req.requirement}** (Score: ${(req.coverageScore * 100).toFixed(0)}%)\n`
          if (req.evidence.length > 0) {
            enhancedReport += `  - Evidence: "${req.evidence[0]}"\n`
          }
        })
      enhancedReport += '\n'
    }

    if (missedReqs.length > 0) {
      enhancedReport += `### Missed Requirements\n`
      missedReqs.slice(0, 5).forEach(req => {
        enhancedReport += `- ${req.requirement}\n`
      })
      enhancedReport += '\n'
    }

    return enhancedReport

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