import { NextResponse } from 'next/server'

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

    console.log('=== GENERATING INTERVIEW TRANSCRIPT ===')
    console.log('Total messages:', messages.length)
    console.log('Personas:', personas.map(p => p.name).join(', '))

    // Generate the complete transcript
    const transcript = generateTranscript(messages, personas)

    return NextResponse.json({
      requirements: transcript,
      success: true
    })

  } catch (error) {
    console.error('Transcript generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate transcript' },
      { status: 500 }
    )
  }
}

function generateTranscript(messages: Message[], personas: Persona[]): string {
  const lines: string[] = []

  // Header
  lines.push('=' .repeat(80))
  lines.push('REQUIREMENTS ELICITATION INTERVIEW TRANSCRIPT')
  lines.push('=' .repeat(80))
  lines.push('')

  // Session info
  const startTime = new Date(messages[0]?.timestamp || Date.now())
  const endTime = new Date(messages[messages.length - 1]?.timestamp || Date.now())
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000 / 60)

  lines.push(`Date: ${startTime.toLocaleDateString()}`)
  lines.push(`Start Time: ${startTime.toLocaleTimeString()}`)
  lines.push(`End Time: ${endTime.toLocaleTimeString()}`)
  lines.push(`Duration: ${duration} minutes`)
  lines.push(`Total Messages: ${messages.length}`)
  lines.push('')

  // Participants
  lines.push('PARTICIPANTS:')
  lines.push('-'.repeat(40))
  lines.push('Student (Interviewer)')
  personas.forEach(persona => {
    lines.push(`${persona.name} - ${persona.role}`)
  })
  lines.push('')

  // Persona details
  lines.push('STAKEHOLDER PROFILES:')
  lines.push('-'.repeat(40))
  personas.forEach(persona => {
    lines.push(`${persona.name} (${persona.role})`)
    lines.push(`  Goal: ${persona.goal}`)
    lines.push(`  Concerns: ${persona.concerns}`)
    lines.push(`  Personality: ${persona.personality}`)
    lines.push('')
  })

  // Interview transcript
  lines.push('INTERVIEW CONVERSATION:')
  lines.push('-'.repeat(80))
  lines.push('')

  messages.forEach((msg, index) => {
    const time = new Date(msg.timestamp).toLocaleTimeString()
    const speaker = msg.sender === 'student' ? 'STUDENT' : msg.personaName || 'UNKNOWN'

    lines.push(`[${time}] ${speaker}:`)

    // Wrap long messages for readability
    const wrappedContent = wrapText(msg.content, 76)
    wrappedContent.forEach(line => {
      lines.push(`  ${line}`)
    })

    lines.push('')
  })

  // Summary statistics
  lines.push('-'.repeat(80))
  lines.push('INTERVIEW STATISTICS:')
  lines.push('-'.repeat(40))

  // Count messages per participant
  const messageCounts: Record<string, number> = { 'Student': 0 }
  personas.forEach(p => { messageCounts[p.name] = 0 })

  messages.forEach(msg => {
    if (msg.sender === 'student') {
      messageCounts['Student']++
    } else if (msg.personaName && messageCounts[msg.personaName] !== undefined) {
      messageCounts[msg.personaName]++
    }
  })

  lines.push('Messages per participant:')
  Object.entries(messageCounts).forEach(([name, count]) => {
    const percentage = ((count / messages.length) * 100).toFixed(1)
    lines.push(`  ${name}: ${count} messages (${percentage}%)`)
  })

  lines.push('')
  lines.push('=' .repeat(80))
  lines.push('END OF TRANSCRIPT')
  lines.push('=' .repeat(80))

  return lines.join('\n')
}

// Helper function to wrap text at a specific width
function wrapText(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  words.forEach(word => {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  })

  if (currentLine) lines.push(currentLine)
  return lines
}