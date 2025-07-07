import { NextResponse } from 'next/server'

interface Message {
  id: string
  sender: 'student' | 'persona' | 'system'
  personaName?: string
  content: string
  timestamp: Date
  metadata?: Record<string, any>
}

interface SessionData {
  sessionId: string
  projectName: string
  studentName: string
  startTime: Date
  endTime?: Date
  messages: Message[]
  personasInterviewed: string[]
  status: 'active' | 'completed' | 'abandoned'
  requirementsExtracted: boolean
  transcriptDownloaded: boolean
}

// In-memory storage (in production, use a real database)
// This persists across API calls but resets when server restarts
const sessionStorage = new Map<string, SessionData>()

// GET: Retrieve all sessions for a project
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const projectName = searchParams.get('projectName')

    if (!projectName) {
      // Return all sessions
      const allSessions = Array.from(sessionStorage.values())
      return NextResponse.json({ sessions: allSessions })
    }

    // Filter sessions by project name
    const projectSessions = Array.from(sessionStorage.values())
      .filter(session => session.projectName === projectName)

    return NextResponse.json({ sessions: projectSessions })
  } catch (error) {
    console.error('Error retrieving sessions:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve sessions' },
      { status: 500 }
    )
  }
}

// POST: Save or update a session
export async function POST(req: Request) {
  try {
    const sessionData: SessionData = await req.json()

    if (!sessionData.sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    // Store the session data
    sessionStorage.set(sessionData.sessionId, {
      ...sessionData,
      // Ensure dates are Date objects
      startTime: new Date(sessionData.startTime),
      endTime: sessionData.endTime ? new Date(sessionData.endTime) : undefined,
      messages: sessionData.messages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }))
    })

    console.log(`Session ${sessionData.sessionId} saved. Total sessions: ${sessionStorage.size}`)

    return NextResponse.json({
      success: true,
      sessionId: sessionData.sessionId,
      totalSessions: sessionStorage.size
    })
  } catch (error) {
    console.error('Error saving session:', error)
    return NextResponse.json(
      { error: 'Failed to save session' },
      { status: 500 }
    )
  }
}

// DELETE: Remove a session (optional)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID required' },
        { status: 400 }
      )
    }

    const deleted = sessionStorage.delete(sessionId)

    return NextResponse.json({
      success: deleted,
      message: deleted ? 'Session deleted' : 'Session not found'
    })
  } catch (error) {
    console.error('Error deleting session:', error)
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    )
  }
}