import { NextResponse } from 'next/server'
import { CohereClient } from 'cohere-ai'

// Initialize Cohere client
console.log('Cohere API Key exists:', !!process.env.CO_API_KEY)
console.log('API Key length:', process.env.CO_API_KEY?.length)

const cohere = new CohereClient({
  token: process.env.CO_API_KEY!
})

interface Message {
  id: string
  sender: 'student' | 'persona'
  personaName?: string
  content: string
  timestamp: Date
}

interface Persona {
  name: string
  initials: string
  role: string
  goal: string
  concerns: string
  personality: string
}

interface TranscriptRequest {
  messages: Message[]
  selectedMessageIds?: string[] // NEW: Optional selected message IDs
  personas: Persona[]
}

export async function POST(req: Request) {
  try {
    const { messages, selectedMessageIds, personas }: TranscriptRequest = await req.json()

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'No messages to extract' },
        { status: 400 }
      )
    }

    // NEW: Filter messages if specific ones are selected
    const relevantMessages = selectedMessageIds && selectedMessageIds.length > 0
      ? messages.filter(m => selectedMessageIds.includes(m.id))
      : messages

    if (relevantMessages.length === 0) {
      return NextResponse.json(
        { error: 'No selected messages found' },
        { status: 400 }
      )
    }

    console.log('=== GENERATING REQUIREMENTS FROM INTERVIEW ===')
    console.log('Total messages:', messages.length)
    console.log('Messages to analyze:', relevantMessages.length)
    console.log('Selected mode:', selectedMessageIds ? 'Yes' : 'No')
    console.log('Personas:', personas.map(p => p.name).join(', '))

    // Build a transcript from selected messages
    let transcript = 'INTERVIEW TRANSCRIPT:\n\n'
    relevantMessages.forEach(msg => {
      const speaker = msg.sender === 'student' ? 'STUDENT' : msg.personaName || 'PERSONA'
      transcript += `${speaker}: ${msg.content}\n\n`
    })

    // Add persona context
    transcript += '\nSTAKEHOLDER INFORMATION:\n'
    personas.forEach(p => {
      transcript += `${p.name} (${p.role}): Goal - ${p.goal}, Concerns - ${p.concerns}\n`
    })

    // Enhanced prompt for selective extraction
    const selectionContext = selectedMessageIds && selectedMessageIds.length > 0
      ? `\nNOTE: This is a SELECTED portion of the conversation (${relevantMessages.length} out of ${messages.length} messages). Focus only on requirements mentioned in these selected messages.\n`
      : ''

    const prompt = `Analyze this interview transcript and extract project requirements.

${transcript}
${selectionContext}
Extract all project requirements mentioned in the conversation. Format as a numbered list (1, 2, 3, etc.).
Each requirement should be clear and actionable. Include who mentioned it in brackets.

${selectedMessageIds ? 'Since this is a partial selection, only extract requirements from the selected messages shown above.' : ''}

Example format:
1. The system must have user authentication [Source: John Smith]
2. Users should be able to export data to PDF [Source: Sarah Lee]

List all requirements you find:`

    // Call Cohere API
    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens: 2000,
      temperature: 0.3,
    })

    // Get the requirements from Cohere
    const extractedRequirements = response.text?.trim() || 'No requirements could be extracted.'

    // Generate the final document with context about selection
    const requirements = generateRequirementsDocument(
      extractedRequirements,
      relevantMessages,
      messages,
      personas,
      selectedMessageIds
    )

    return NextResponse.json({
      requirements: requirements,
      success: true,
      metadata: {
        totalMessages: messages.length,
        analyzedMessages: relevantMessages.length,
        selectionMode: !!selectedMessageIds
      }
    })

  } catch (error) {
    console.error('Requirements extraction error:', error)
    return NextResponse.json(
      { error: 'Failed to generate requirements' },
      { status: 500 }
    )
  }
}

function generateRequirementsDocument(
  extractedReqs: string,
  relevantMessages: Message[],
  allMessages: Message[],
  personas: Persona[],
  selectedMessageIds?: string[]
): string {
  const lines: string[] = []

  // Header
  lines.push('=' .repeat(80))
  lines.push('PROJECT REQUIREMENTS EXTRACTED FROM INTERVIEW')
  lines.push('=' .repeat(80))
  lines.push('')

  // Session info
  const startTime = new Date(allMessages[0]?.timestamp || Date.now())
  lines.push(`Date: ${startTime.toLocaleDateString()}`)
  lines.push(`Stakeholders Interviewed: ${personas.map(p => p.name).join(', ')}`)

  // NEW: Selection info
  if (selectedMessageIds && selectedMessageIds.length > 0) {
    lines.push(`Analysis Mode: Selected Messages`)
    lines.push(`Messages Analyzed: ${relevantMessages.length} of ${allMessages.length} total messages`)
  } else {
    lines.push(`Analysis Mode: Full Conversation`)
    lines.push(`Total Messages: ${allMessages.length}`)
  }

  lines.push('')

  // Requirements
  lines.push('EXTRACTED REQUIREMENTS:')
  lines.push('-'.repeat(80))
  lines.push('')
  lines.push(extractedReqs)
  lines.push('')

  // NEW: Add note about partial extraction if applicable
  if (selectedMessageIds && selectedMessageIds.length > 0) {
    lines.push('')
    lines.push('NOTE: This extraction is based on selected messages only.')
    lines.push('Additional requirements may exist in the unselected portions of the conversation.')
    lines.push('')
  }

  // Footer
  lines.push('=' .repeat(80))
  lines.push('END OF REQUIREMENTS')
  lines.push('=' .repeat(80))

  return lines.join('\n')
}