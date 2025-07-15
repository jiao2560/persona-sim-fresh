import { NextResponse } from 'next/server'
import { CohereClient } from 'cohere-ai'

// Initialize Cohere client
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
  personas: Persona[]
}

export async function POST(req: Request) {
  try {
    const { messages, personas }: TranscriptRequest = await req.json()

    if (!messages || messages.length === 0) {
      return NextResponse.json(
        { error: 'No messages to extract' },
        { status: 400 }
      )
    }

    console.log('=== GENERATING REQUIREMENTS FROM INTERVIEW ===')
    console.log('Total messages:', messages.length)
    console.log('Personas:', personas.map(p => p.name).join(', '))

    // Build a simple transcript
    let transcript = 'INTERVIEW TRANSCRIPT:\n\n'
    messages.forEach(msg => {
      const speaker = msg.sender === 'student' ? 'STUDENT' : msg.personaName || 'PERSONA'
      transcript += `${speaker}: ${msg.content}\n\n`
    })

    // Add persona context
    transcript += '\nSTAKEHOLDER INFORMATION:\n'
    personas.forEach(p => {
      transcript += `${p.name} (${p.role}): Goal - ${p.goal}, Concerns - ${p.concerns}\n`
    })

    // Simple prompt for Cohere
    const prompt = `Analyze this interview transcript and extract project requirements.

${transcript}

Extract all project requirements mentioned in the conversation. Format as a numbered list (1, 2, 3, etc.).
Each requirement should be clear and actionable. Include who mentioned it in brackets.

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

    // Generate the final document
    const requirements = generateRequirementsDocument(extractedRequirements, messages, personas)

    return NextResponse.json({
      requirements: requirements,
      success: true
    })

  } catch (error) {
    console.error('Requirements extraction error:', error)
    return NextResponse.json(
      { error: 'Failed to generate requirements' },
      { status: 500 }
    )
  }
}

function generateRequirementsDocument(extractedReqs: string, messages: Message[], personas: Persona[]): string {
  const lines: string[] = []

  // Header
  lines.push('=' .repeat(80))
  lines.push('PROJECT REQUIREMENTS EXTRACTED FROM INTERVIEW')
  lines.push('=' .repeat(80))
  lines.push('')

  // Session info
  const startTime = new Date(messages[0]?.timestamp || Date.now())
  lines.push(`Date: ${startTime.toLocaleDateString()}`)
  lines.push(`Stakeholders Interviewed: ${personas.map(p => p.name).join(', ')}`)
  lines.push('')

  // Requirements
  lines.push('EXTRACTED REQUIREMENTS:')
  lines.push('-'.repeat(80))
  lines.push('')
  lines.push(extractedReqs)
  lines.push('')

  // Footer
  lines.push('=' .repeat(80))
  lines.push('END OF REQUIREMENTS')
  lines.push('=' .repeat(80))

  return lines.join('\n')
}