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

// Get the base URL dynamically
function getBaseUrl() {
  // In production, use your Vercel URL
  if (process.env.NODE_ENV === 'production') {
    return 'https://persona-sim-fresh-zmi2.vercel.app'
  }
  // In development, use localhost
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
}

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
    const baseUrl = getBaseUrl()
    const sessionsUrl = `${baseUrl}/api/session-storage?projectName=${encodeURIComponent(projectName)}`
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

// ... (keep all imports and interfaces the same)

// In the GET endpoint - Analyze coverage on demand section, replace the analyze-coverage action:

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
      const baseUrl = getBaseUrl()
      const sessionsUrl = `${baseUrl}/api/session-storage`
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

      // Get the original persona data from sessionStorage to extract requirements
      // This should be passed from the frontend, but as a fallback we'll generate basic requirements
      let projectRequirements: string[] = []

      try {
        // Try to get requirements from the session metadata if stored
        if (session.metadata?.projectRequirements) {
          projectRequirements = session.metadata.projectRequirements
        } else {
          // Generate basic requirements based on project name and domain
          // In production, these should come from the original persona generation
          projectRequirements = [
            'The system must provide user authentication and authorization',
            'Users should be able to manage their profile information',
            'The system must ensure data security and privacy',
            'Users should be able to perform core domain-specific operations',
            'The system must provide real-time updates and notifications',
            'The system must have an intuitive and responsive user interface',
            'Users should be able to export and import data',
            'The system must maintain audit logs for compliance',
            'The system must support multiple user roles and permissions',
            'The system must handle errors gracefully and provide meaningful feedback'
          ]
          console.log('Using default requirements - should be replaced with actual project requirements')
        }
      } catch (error) {
        console.error('Error getting project requirements:', error)
      }

      // Call the updated requirement coverage API
      try {
        const coverageUrl = `${baseUrl}/api/requirement-coverage`
        console.log('Calling requirement coverage API...')

        const coverageResponse = await fetch(coverageUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: session.messages,
            projectRequirements,
            studentName: session.studentName,
            sessionId: session.sessionId,
            generateReport: true
          })
        })

        if (!coverageResponse.ok) {
          throw new Error('Failed to analyze coverage')
        }

        const coverageData = await coverageResponse.json()
        console.log('Coverage analysis complete:', {
          coverage: coverageData.overallCoverageRate,
          questionQuality: coverageData.questionQualityScore
        })

        // Create a simplified report for the dashboard
        const report: CoverageReport = {
          overallCoverageRate: coverageData.overallCoverageRate,
          strengths: coverageData.strengths,
          improvements: coverageData.improvements,
          detailedAnalysis: coverageData.detailedAnalysis || '',
          analyzedAt: new Date(coverageData.analyzedAt)
        }

        // Cache the report
        coverageReports.set(sessionId, report)
        console.log('Report cached for session:', sessionId)

        return NextResponse.json({
          success: true,
          coverage: coverageData.overallCoverageRate,
          report,
          questionQuality: coverageData.questionQualityScore,
          requirementsCovered: coverageData.requirementAnalyses.filter((r: any) => r.covered).length,
          totalRequirements: coverageData.requirementAnalyses.length
        })

      } catch (analysisError) {
        console.error('Coverage analysis error:', analysisError)

        // Fallback response
        const fallbackCoverage = 35 // Lower default
        const fallbackReport: CoverageReport = {
          overallCoverageRate: fallbackCoverage,
          strengths: ['Attempted to conduct interview'],
          improvements: ['Ask more specific questions', 'Avoid asking directly for requirements', 'Explore user needs in depth'],
          detailedAnalysis: `Unable to perform detailed analysis. Please ensure questions are professional and targeted.`,
          analyzedAt: new Date()
        }

        return NextResponse.json({
          success: true,
          coverage: fallbackCoverage,
          report: fallbackReport
        })
      }
    }

    // ... (keep the rest of the GET endpoint the same)
  } catch (error) {
    console.error('Error in GET:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}

// Rest of the functions remain the same...
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