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

interface Persona {
  name: string
  initials: string
  role: string
  goal: string
  concerns: string
  personality: string
}

interface StudentSession {
  sessionId: string
  studentName: string
  startTime: Date
  endTime?: Date
  duration: number
  messageCount: number
  personasInterviewed: string[]
  lastActivity: Date
  status: 'active' | 'completed' | 'abandoned'
  requirementsExtracted: boolean
  transcriptDownloaded: boolean
  requirementCoverageRate?: number
  coverageReport?: CoverageReport
}

interface CoverageReport {
  overallCoverageRate: number
  strengths: string[]
  improvements: string[]
  detailedAnalysis: string
  analyzedAt: Date
}

interface PersonaEngagement {
  personaName: string
  messageCount: number
  engagementRate: number
  collaborativeDiscussions: number
}

interface ClassOverview {
  totalStudents: number
  activeStudents: number
  completedSessions: number
  avgSessionDuration: number
  avgMessagesPerSession: number
  personaEngagement: PersonaEngagement[]
  overallProgress: number
}

interface RecentActivityItem {
  timestamp: Date
  studentName: string
  action: string
  details: string
}

interface DashboardResponse {
  projectName: string
  domain: string
  personas: Persona[]
  studentSessions: StudentSession[]
  classOverview: ClassOverview
  recentActivity: RecentActivityItem[]
}

// Store coverage reports in memory
const coverageReports = new Map<string, CoverageReport>()

export async function POST(req: Request) {
  try {
    const { projectName, domain, personas } = await req.json()

    console.log('=== POST: INSTRUCTOR DASHBOARD ===')
    console.log('Project:', projectName)
    console.log('Domain:', domain)
    console.log('Personas count:', personas?.length)

    if (!projectName || !personas || personas.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Fetch real session data from storage API
    const sessionsUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session-storage?projectName=${encodeURIComponent(projectName)}`
    console.log('Fetching sessions from:', sessionsUrl)

    const sessionsResponse = await fetch(sessionsUrl)

    if (!sessionsResponse.ok) {
      console.error('Failed to fetch sessions:', sessionsResponse.status)
      return NextResponse.json({
        projectName,
        domain: domain || 'General',
        personas,
        studentSessions: [],
        classOverview: createEmptyOverview(),
        recentActivity: []
      })
    }

    const { sessions: rawSessions } = await sessionsResponse.json()
    console.log('Raw sessions count:', rawSessions.length)

    // Process raw sessions WITHOUT analyzing coverage here
    const studentSessions: StudentSession[] = []

    for (const session of rawSessions) {
      // Just process basic session data
      studentSessions.push({
        sessionId: session.sessionId,
        studentName: session.studentName,
        startTime: new Date(session.startTime),
        endTime: session.endTime ? new Date(session.endTime) : undefined,
        duration: session.endTime
          ? Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000 / 60)
          : 0,
        messageCount: session.messages.length,
        personasInterviewed: session.personasInterviewed,
        lastActivity: session.messages.length > 0
          ? new Date(session.messages[session.messages.length - 1].timestamp)
          : new Date(session.startTime),
        status: session.status,
        requirementsExtracted: session.requirementsExtracted,
        transcriptDownloaded: session.transcriptDownloaded,
        requirementCoverageRate: undefined, // Will be calculated on demand
        coverageReport: undefined // Will be generated on demand
      })
    }

    // Calculate real class overview
    const classOverview = calculateRealClassOverview(studentSessions, personas, rawSessions)

    // Generate real recent activity
    const recentActivity = generateRealRecentActivity(rawSessions)

    const dashboardData: DashboardResponse = {
      projectName,
      domain: domain || 'General',
      personas,
      studentSessions,
      classOverview,
      recentActivity
    }

    console.log('Returning dashboard data with', studentSessions.length, 'sessions')
    return NextResponse.json(dashboardData)

  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 }
    )
  }
}

// GET endpoint - Analyze coverage on demand
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')
    const action = searchParams.get('action')

    console.log('=== GET: INSTRUCTOR DASHBOARD ===')
    console.log('SessionId:', sessionId)
    console.log('Action:', action)

    if (action === 'analyze-coverage' && sessionId) {
      console.log('Analyzing coverage for session:', sessionId)

      // Fetch the session data
      const sessionsUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/session-storage`
      console.log('Fetching all sessions from:', sessionsUrl)

      const sessionsResponse = await fetch(sessionsUrl)
      if (!sessionsResponse.ok) {
        console.error('Failed to fetch sessions:', sessionsResponse.status)
        throw new Error('Failed to fetch sessions')
      }

      const { sessions } = await sessionsResponse.json()
      console.log('Total sessions found:', sessions.length)

      const session = sessions.find((s: any) => s.sessionId === sessionId)

      if (!session) {
        console.error('Session not found:', sessionId)
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      }

      console.log('Found session with', session.messages.length, 'messages')

      // Build project context
      const projectContext = `
Project: ${session.projectName || 'Software Development Project'}
Domain: Requirements Elicitation Training

The student is interviewing personas to elicit requirements for a software system.
Each persona has specific goals and concerns that should be addressed.

Personas interviewed:
${session.personasInterviewed.join(', ')}
      `.trim()

      // Build interview transcript
      const transcript = session.messages
        .filter((msg: any) => msg.sender !== 'system')
        .map((msg: any) => `${msg.sender === 'student' ? 'Student' : msg.personaName || 'Persona'}: ${msg.content}`)
        .join('\n')

      console.log('Transcript length:', transcript.length, 'characters')

      // Call Cohere to analyze the transcript
      try {
        const prompt = `Analyze this requirements elicitation interview and calculate the coverage percentage.

PROJECT CONTEXT:
${projectContext}

INTERVIEW TRANSCRIPT:
${transcript}

TASK:
1. Identify key requirements that should have been elicited based on the personas' roles
2. Determine which requirements were actually discussed
3. Calculate a coverage percentage (0-100%)
4. Provide specific strengths and areas for improvement

FORMAT YOUR RESPONSE AS:
COVERAGE: [0-100]
STRENGTHS:
- [Strength 1]
- [Strength 2]
IMPROVEMENTS:
- [Improvement 1]
- [Improvement 2]
SUMMARY: [2-3 sentence summary of the interview performance]`

        console.log('Calling Cohere API...')
        const response = await cohere.chat({
          model: 'command-r-plus',
          message: prompt,
          maxTokens: 500,
          temperature: 0.3,
        })

        const responseText = response.text || ''
        console.log('Cohere response received, length:', responseText.length)

        // Parse the response
        const coverageMatch = responseText.match(/COVERAGE:\s*(\d+)/i)
        const strengthsMatch = responseText.match(/STRENGTHS:\s*([\s\S]*?)(?=IMPROVEMENTS:|$)/i)
        const improvementsMatch = responseText.match(/IMPROVEMENTS:\s*([\s\S]*?)(?=SUMMARY:|$)/i)
        const summaryMatch = responseText.match(/SUMMARY:\s*([\s\S]*)/i)

        const coverage = coverageMatch ? parseInt(coverageMatch[1]) : 50
        console.log('Parsed coverage:', coverage)

        const parsePoints = (text: string): string[] => {
          if (!text) return []
          return text
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.replace(/^-\s*/, '').trim())
            .filter(point => point.length > 0)
        }

        const strengths = strengthsMatch ? parsePoints(strengthsMatch[1]) : ['Engaged with personas']
        const improvements = improvementsMatch ? parsePoints(improvementsMatch[1]) : ['Explore requirements more deeply']
        const summary = summaryMatch ? summaryMatch[1].trim() : 'Interview session analyzed.'

        console.log('Parsed strengths:', strengths.length)
        console.log('Parsed improvements:', improvements.length)

        // Generate detailed report
        const detailedReport = `# Requirements Coverage Analysis Report

**Session ID:** ${sessionId}
**Student:** ${session.studentName}
**Coverage Rate:** ${coverage}%
**Analysis Date:** ${new Date().toLocaleDateString()}

## Executive Summary
${summary}

## Performance Metrics
- Total Messages: ${session.messages.length}
- Student Questions: ${session.messages.filter((m: any) => m.sender === 'student').length}
- Personas Interviewed: ${session.personasInterviewed.join(', ')}
- Interview Duration: ${Math.round((new Date(session.endTime || session.startTime).getTime() - new Date(session.startTime).getTime()) / 1000 / 60)} minutes

## Strengths
${strengths.map(s => `- ${s}`).join('\n')}

## Areas for Improvement
${improvements.map(i => `- ${i}`).join('\n')}

## Recommendations
Based on the ${coverage}% coverage rate, the student should focus on:
${improvements.map((imp, idx) => `${idx + 1}. ${imp}`).join('\n')}

## Grade Recommendation
${coverage >= 80 ? 'Excellent (A)' :
  coverage >= 70 ? 'Good (B)' :
  coverage >= 60 ? 'Satisfactory (C)' :
  coverage >= 50 ? 'Needs Improvement (D)' :
  'Insufficient (F)'} - ${coverage}% coverage achieved`

        const report: CoverageReport = {
          overallCoverageRate: coverage,
          strengths,
          improvements,
          detailedAnalysis: detailedReport,
          analyzedAt: new Date()
        }

        // Cache the report
        coverageReports.set(sessionId, report)
        console.log('Report cached for session:', sessionId)

        return NextResponse.json({
          success: true,
          coverage,
          report
        })

      } catch (cohereError) {
        console.error('Cohere API error:', cohereError)
        return NextResponse.json(
          { error: 'Failed to analyze coverage with AI' },
          { status: 500 }
        )
      }
    }

    // Get cached report
    if (action === 'get-report' && sessionId) {
      console.log('Getting cached report for session:', sessionId)
      const report = coverageReports.get(sessionId)
      if (report) {
        console.log('Found cached report')
        return NextResponse.json({ report })
      } else {
        console.log('No cached report found')
        return NextResponse.json(
          { error: 'Report not found. Please analyze first.' },
          { status: 404 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    )

  } catch (error) {
    console.error('Error in GET:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}

// Extract requirements from personas' goals and concerns
function extractProjectRequirements(personas: Persona[]): string[] {
  const requirements: string[] = []

  personas.forEach(persona => {
    // Extract requirements from goals
    const goalRequirements = persona.goal
      .split(/[,;.]/)
      .map(req => req.trim())
      .filter(req => req.length > 10)
      .map(req => `System must ${req.toLowerCase()}`)

    requirements.push(...goalRequirements)

    // Extract requirements from concerns (as constraints)
    const concernRequirements = persona.concerns
      .split(/[,;.]/)
      .map(concern => concern.trim())
      .filter(concern => concern.length > 10)
      .map(concern => `System must address: ${concern.toLowerCase()}`)

    requirements.push(...concernRequirements)
  })

  // Remove duplicates and return
  return [...new Set(requirements)]
}

function createEmptyOverview(): ClassOverview {
  return {
    totalStudents: 0,
    activeStudents: 0,
    completedSessions: 0,
    avgSessionDuration: 0,
    avgMessagesPerSession: 0,
    personaEngagement: [],
    overallProgress: 0
  }
}

function calculateRealClassOverview(
  sessions: StudentSession[],
  personas: Persona[],
  rawSessions: any[]
): ClassOverview {
  const completedSessions = sessions.filter(s => s.status === 'completed')
  const activeSessions = sessions.filter(s => s.status === 'active')

  // Calculate real persona engagement from messages
  const personaEngagementMap: Record<string, PersonaEngagement> = {}

  personas.forEach(persona => {
    let totalMessages = 0
    let collaborativeCount = 0

    rawSessions.forEach(session => {
      session.messages.forEach((msg: any) => {
        if (msg.sender === 'persona' && msg.personaName === persona.name) {
          totalMessages++
          if (msg.metadata?.discussionRound) {
            collaborativeCount++
          }
        }
      })
    })

    const sessionsWithPersona = sessions.filter(s =>
      s.personasInterviewed.includes(persona.name)
    )

    personaEngagementMap[persona.name] = {
      personaName: persona.name,
      messageCount: totalMessages,
      engagementRate: sessions.length > 0 ? (sessionsWithPersona.length / sessions.length) * 100 : 0,
      collaborativeDiscussions: collaborativeCount
    }
  })

  return {
    totalStudents: new Set(sessions.map(s => s.studentName)).size,
    activeStudents: activeSessions.length,
    completedSessions: completedSessions.length,
    avgSessionDuration: completedSessions.length > 0
      ? completedSessions.reduce((sum, s) => sum + s.duration, 0) / completedSessions.length
      : 0,
    avgMessagesPerSession: sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.messageCount, 0) / sessions.length
      : 0,
    personaEngagement: Object.values(personaEngagementMap),
    overallProgress: sessions.length > 0 ? (completedSessions.length / sessions.length) * 100 : 0
  }
}

function generateRealRecentActivity(rawSessions: any[]): RecentActivityItem[] {
  const activities: RecentActivityItem[] = []

  // Extract real activities from session data
  rawSessions.forEach(session => {
    // Session start
    activities.push({
      timestamp: new Date(session.startTime),
      studentName: session.studentName,
      action: 'Started interview',
      details: `🟢 ${session.personasInterviewed.join(', ')}`
    })

    // Requirements extracted
    if (session.requirementsExtracted && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1]
      activities.push({
        timestamp: new Date(lastMsg.timestamp),
        studentName: session.studentName,
        action: 'Extracted requirements',
        details: `📋 After ${session.messages.length} messages`
      })
    }

    // Transcript downloaded
    if (session.transcriptDownloaded && session.endTime) {
      activities.push({
        timestamp: new Date(session.endTime),
        studentName: session.studentName,
        action: 'Downloaded transcript',
        details: `💾 Session completed`
      })
    }

    // Collaborative discussions
    session.messages.forEach((msg: any) => {
      if (msg.metadata?.discussionRound && msg.metadata?.speakingOrder === 1) {
        activities.push({
          timestamp: new Date(msg.timestamp),
          studentName: session.studentName,
          action: 'Engaged in collaborative discussion',
          details: `🤝 ${msg.metadata.collaborationGoal || 'Team discussion'}`
        })
      }
    })

    // Session completion
    if (session.status === 'completed' && session.endTime) {
      activities.push({
        timestamp: new Date(session.endTime),
        studentName: session.studentName,
        action: 'Completed interview',
        details: `✅ ${session.messageCount} messages, ${Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000 / 60)} minutes`
      })
    }
  })

  // Sort by timestamp and return most recent
  return activities
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 20) // Show last 20 activities
}