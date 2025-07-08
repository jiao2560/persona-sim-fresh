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

interface InstructorConfig {
  requireAllPersonas?: boolean
  maxResponseLength?: number
  forcedPersonaOrder?: string[]
  personalityEmphasis?: boolean
  summaryInterval?: number // Summarize every N turns
}

interface AgentState {
  messages: Message[]
  currentSpeaker: string | null
  conversationContext: string
  conversationSummary: string // Enhanced memory for longer sessions
  registeredPersonas: Persona[] // Full roster - never mutated
  engagedPersonas: Persona[] // Currently selected personas
  sessionId: string
  turnCount: number
  lastAction: string
  previouslyEngagedPersonas: string[]
  personaTurnHistory: Record<string, number> // Track turn frequency
  instructorConfig: InstructorConfig // Instructor settings
  collaborativeGoals: Record<string, string[]> // Track team consensus
  analysisResult?: {
    intent: "targeted" | "general" | "follow_up"
    targetPersonas: string[]
    topic: string
    confidence: number
    reasoning: string
    collaborationGoal?: string // What the team needs to achieve
  }
}

interface NodeResult {
  nextNode?: string
  shouldContinue: boolean
  responses?: PersonaResponse[]
  updatedState: AgentState
}

interface PersonaResponse {
  personaName: string
  content: string
  agentId: string
  confidence: number
  reasoning?: string
}

interface RequestBody {
  message: string
  personas: Persona[]
  conversationHistory: Message[]
  sessionId?: string
  instructorConfig?: InstructorConfig
}

// LangGraph Node Types
type GraphNode = (state: AgentState) => Promise<NodeResult>

// LangGraph-inspired workflow orchestrator
class InterviewWorkflow {
  private nodes: Map<string, GraphNode>
  private edges: Map<string, string[]>
  private conditionalEdges: Map<string, (state: AgentState) => string>

  constructor() {
    this.nodes = new Map()
    this.edges = new Map()
    this.conditionalEdges = new Map()
    this.buildWorkflow()
  }

  private buildWorkflow(): void {
    /*
    EDGE PRECEDENCE & FLOW DIAGRAM:
    ================================

    analyze_input ────────────────► route_to_personas
         │                              │
                                        │
                                        ▼
                                collaborative_discussion ◄─── [CONDITIONAL: if collaboration detected]
                                       │
                                       ▼
                                generate_responses
                                       │
                                       ▼
                                validate_responses
                                 │            │
                                 ▼            └─► [CONDITIONAL: retry if
                            format_output         validation fails]




    */

    // Define workflow nodes
    this.addNode('analyze_input', this.analyzeInputNode.bind(this))
    this.addNode('route_to_personas', this.routeToPersonasNode.bind(this))
    this.addNode('collaborative_discussion', this.collaborativeDiscussionNode.bind(this))
    this.addNode('collaboration_summary', this.collaborationSummaryNode.bind(this))
    this.addNode('generate_responses', this.generateResponsesNode.bind(this))
    this.addNode('validate_responses', this.validateResponsesNode.bind(this))
    this.addNode('format_output', this.formatOutputNode.bind(this))
    this.addNode('summarize_context', this.summarizeContextNode.bind(this))

    // Enhanced conditional routing with confidence thresholds
    this.addConditionalEdge('analyze_input', (state: AgentState) => {
      const analysis = state.analysisResult
      if (!analysis || analysis.confidence < 0.4) {
        console.log('⚠️ Low analysis confidence, retrying...')
        return 'analyze_input' // Retry analysis
      }

      // Check if we need to summarize (instructor config)
      const interval = state.instructorConfig.summaryInterval || 20
      if (state.turnCount > 0 && state.turnCount % interval === 0) {
        return 'summarize_context'
      }

      return 'route_to_personas'
    })

    // NEW: Route to collaborative discussion if collaboration detected
    this.addConditionalEdge('route_to_personas', (state: AgentState) => {
      const latestMessage = state.messages[state.messages.length - 1]
      if (latestMessage && this.isCollaborationPrompt(latestMessage.content) && state.engagedPersonas.length > 1) {
        console.log('🤝 Collaboration detected - routing to collaborative discussion')
        return 'collaborative_discussion'
      }
      return 'generate_responses'
    })

    // NEW: Route to collaboration summary after 3+ collaborative turns
    this.addConditionalEdge('collaborative_discussion', (state: AgentState) => {
      const collaborativeTurns = state.messages.filter(msg =>
        msg.metadata?.discussionRound === true
      ).length

      if (collaborativeTurns >= 3 && state.analysisResult?.collaborationGoal) {
        console.log('🤝 Enough collaborative turns - routing to summary')
        return 'collaboration_summary'
      }
      return 'validate_responses'
    })

    this.addConditionalEdge('validate_responses', (state: AgentState) => {
      const recentMessages = state.messages.filter(msg => msg.sender === 'persona').slice(-state.engagedPersonas.length)
      const hasValidResponses = recentMessages.every(msg =>
        msg.content.length > 15 &&
        !this.isOutOfCharacter(msg.content) &&
        (msg.metadata?.confidence || 0) > 0.5
      )
      return hasValidResponses ? 'format_output' : 'generate_responses'
    })

    // Standard edges (lower priority than conditional)
    this.addEdge('summarize_context', ['route_to_personas'])
    this.addEdge('collaboration_summary', ['format_output'])
    this.addEdge('generate_responses', ['validate_responses'])
  }

  private addNode(name: string, fn: GraphNode): void {
    this.nodes.set(name, fn)
  }

  private addEdge(from: string, to: string[]): void {
    this.edges.set(from, to)
  }

  private addConditionalEdge(from: string, condition: (state: AgentState) => string): void {
    this.conditionalEdges.set(from, condition)
  }

  // Helper function to detect collaboration prompts
  private isCollaborationPrompt(content: string): boolean {
    const collaborationKeywords = [
      'discuss', 'together', 'agree on', 'as a team', 'jointly', 'collaborate',
      'work together', 'consensus', 'decide together', 'team decision',
      'what do you all think', 'reach agreement', 'come to a decision',
      'solve it', 'talk to each other', 'work it out', 'figure out together'
    ]
    const lowerContent = content.toLowerCase()
    return collaborationKeywords.some(keyword => lowerContent.includes(keyword))
  }

  // Helper function to extract collaboration goal from student message
  private extractCollaborationGoal(content: string): string {
    const lowerContent = content.toLowerCase()

    if (lowerContent.includes('tech stack')) return 'tech_stack'
    if (lowerContent.includes('approach') || lowerContent.includes('solution')) return 'approach'
    if (lowerContent.includes('plan')) return 'plan'
    if (lowerContent.includes('requirements')) return 'requirements'
    if (lowerContent.includes('architecture')) return 'architecture'
    if (lowerContent.includes('conflict') || lowerContent.includes('solve it')) return 'conflict_resolution'

    return 'general_consensus'
  }

  // Enhanced out-of-character detection
  private isOutOfCharacter(content: string): boolean {
    const oocPhrases = [
      'as an ai', 'language model', 'i cannot', 'i don\'t have access',
      'i\'m not able to', 'as a chatbot', 'i\'m programmed', 'as an artificial'
    ]
    const lowerContent = content.toLowerCase()
    return oocPhrases.some(phrase => lowerContent.includes(phrase))
  }

  // NEW NODE: Collaboration summary to consolidate team decisions
  private async collaborationSummaryNode(state: AgentState): Promise<NodeResult> {
    console.log('📋 Generating collaboration summary to consolidate team decisions')

    const collaborativeMessages = state.messages.filter(msg =>
      msg.metadata?.discussionRound === true
    )

    const discussionText = collaborativeMessages
      .map(msg => `${msg.personaName}: ${msg.content}`)
      .join('\n\n')

    const collaborationGoal = state.analysisResult?.collaborationGoal || 'general_consensus'

    try {
      const summaryPrompt = `Based on this team discussion, provide a consolidated summary of the team's decisions and consensus:

COLLABORATION GOAL: ${collaborationGoal}

TEAM DISCUSSION:
${discussionText}

Please provide:
1. What the team agreed on (consensus points)
2. Any remaining disagreements or open issues
3. The recommended approach/solution

Format as a brief team summary (2-3 sentences):`

      const response = await cohere.chat({
        model: 'command-r-plus',
        message: summaryPrompt,
        maxTokens: 200,
        temperature: 0.3,
      })

      const summaryContent = response.text?.trim() || "The team discussed the topic and shared various perspectives."

      // Create a summary message
      const summaryMessage: Message = {
        id: `${Date.now()}-team-summary`,
        sender: 'system',
        content: `**Team Consensus Summary:** ${summaryContent}`,
        timestamp: new Date(),
        metadata: {
          isCollaborationSummary: true,
          collaborationGoal,
          participantCount: collaborativeMessages.length
        }
      }

      // Update collaborative goals tracking
      const updatedCollaborativeGoals = { ...state.collaborativeGoals }
      if (collaborationGoal) {
        updatedCollaborativeGoals[collaborationGoal] = [summaryContent]
      }

      return {
        nextNode: 'format_output',
        shouldContinue: true,
        responses: [{
          personaName: 'Team',
          content: summaryContent,
          agentId: 'team-summary',
          confidence: 0.9,
          reasoning: `Team collaboration summary for ${collaborationGoal}`
        }],
        updatedState: {
          ...state,
          messages: [...state.messages, summaryMessage],
          collaborativeGoals: updatedCollaborativeGoals,
          lastAction: 'collaboration_summary_complete'
        }
      }
    } catch (error) {
      console.error('Collaboration summary failed:', error)
      return {
        nextNode: 'format_output',
        shouldContinue: true,
        updatedState: { ...state, lastAction: 'collaboration_summary_failed' }
      }
    }
  }

private async collaborativeDiscussionNode(state: AgentState): Promise<NodeResult> {
  console.log('🤝 Starting collaborative discussion between personas:', state.engagedPersonas.map(p => p.name))

  const responses: PersonaResponse[] = []
  const latestMessage = state.messages[state.messages.length - 1]

  // Extract collaboration goal from analysis result or derive from message
  const collaborationGoal = state.analysisResult?.collaborationGoal ||
    this.extractCollaborationGoal(latestMessage.content)

  // Build consensus items from previous collaborative messages or existing team goals
  const consensusItems: string[] = []
  if (state.collaborativeGoals[collaborationGoal]) {
    consensusItems.push(...state.collaborativeGoals[collaborationGoal])
  }

  // Check if we should encourage challenging (vary the discussion dynamics)
  const collaborativeTurns = state.messages.filter(msg =>
    msg.metadata?.discussionRound === true
  ).length
  const shouldChallenge = collaborativeTurns > 0 && Math.random() > 0.6 // 40% chance to challenge after first turn

  // Generate responses sequentially so each persona can build on previous ones
  for (let i = 0; i < state.engagedPersonas.length; i++) {
    const persona = state.engagedPersonas[i]

    try {
      // Build context of prior replies in this discussion round
      const priorReplies = responses.slice(0, i).map(r => `${r.personaName}: ${r.content}`).join('\n')

      const response = await this.generateCollaborativeResponse(
        persona,
        latestMessage,
        state,
        priorReplies,
        i === 0, // isFirstSpeaker
        collaborationGoal,
        consensusItems,
        shouldChallenge && i > 0 // Only non-first speakers can challenge
      )
      responses.push(response)

      console.log(`✅ Generated collaborative response from ${persona.name} (${i + 1}/${state.engagedPersonas.length})`)

    } catch (error) {
      console.error(`Failed to generate collaborative response for ${persona.name}:`, error)
      responses.push({
        personaName: persona.name,
        content: this.getFallbackResponse(persona, latestMessage.content),
        agentId: persona.name,
        confidence: 0.3,
        reasoning: 'Fallback due to generation error in collaboration'
      })
    }
  }

  // Add responses to state as new messages
  const newMessages = responses.map((resp, index) => ({
    id: `${Date.now()}-${resp.personaName}-${index}`,
    sender: 'persona' as const,
    personaName: resp.personaName,
    content: resp.content,
    timestamp: new Date(),
    metadata: {
      confidence: resp.confidence,
      reasoning: resp.reasoning,
      discussionRound: true,
      speakingOrder: index + 1,
      collaborationGoal: collaborationGoal
    }
  }))

  // Update engagement tracking
  const newlyEngaged = responses.map(r => r.personaName)
  const updatedPreviouslyEngaged = [
    ...state.previouslyEngagedPersonas,
    ...newlyEngaged
  ].slice(-8)

  return {
    nextNode: 'validate_responses',
    shouldContinue: true,
    responses,
    updatedState: {
      ...state,
      messages: [...state.messages, ...newMessages],
      currentSpeaker: responses.length === 1 ? responses[0].personaName : null,
      turnCount: state.turnCount + 1,
      previouslyEngagedPersonas: updatedPreviouslyEngaged,
      lastAction: 'collaborative_discussion_complete'
    }
  }
}
  // New node: Context summarization for memory management
  private async summarizeContextNode(state: AgentState): Promise<NodeResult> {
    console.log('📝 Summarizing conversation context for memory management')

    try {
      const recentMessages = state.messages.slice(-20) // Last 20 messages
      const historyText = recentMessages
        .map(msg => `${msg.sender === 'student' ? 'Student' : msg.personaName}: ${msg.content}`)
        .join('\n')

      const summaryPrompt = `Summarize this interview conversation focusing on key topics, student interests, and persona contributions. Keep it concise (2-3 sentences):

CONVERSATION:
${historyText}

CURRENT SUMMARY: ${state.conversationSummary}

Provide an updated summary that captures the main themes and progression:`

      const response = await cohere.chat({
        model: 'command-r-plus',
        message: summaryPrompt,
        maxTokens: 150,
        temperature: 0.3,
      })

      const newSummary = response.text?.trim() || state.conversationSummary

      return {
        nextNode: 'route_to_personas',
        shouldContinue: true,
        updatedState: {
          ...state,
          conversationSummary: newSummary,
          lastAction: 'context_summarized'
        }
      }
    } catch (error) {
      console.error('Summarization failed:', error)
      return {
        nextNode: 'route_to_personas',
        shouldContinue: true,
        updatedState: { ...state, lastAction: 'summarization_failed' }
      }
    }
  }

  // Enhanced input analysis with robust parsing
  private async analyzeInputNode(state: AgentState): Promise<NodeResult> {
    console.log('🔍 Analyzing input:', state.messages[state.messages.length - 1]?.content)

    const latestMessage = state.messages[state.messages.length - 1]
    if (!latestMessage || latestMessage.sender !== 'student') {
      return {
        shouldContinue: false,
        updatedState: { ...state, lastAction: 'analyze_input_failed' }
      }
    }

    const messageContent = latestMessage.content.toLowerCase()

    // Enhanced direct persona targeting
    const targetedPersonas: string[] = []
    for (const persona of state.registeredPersonas) {
      const nameMatch = messageContent.includes(persona.name.toLowerCase())
      const initialsMatch = messageContent.includes(persona.initials.toLowerCase())
      const roleMatch = messageContent.includes(persona.role.toLowerCase())

      if (nameMatch || initialsMatch || roleMatch) {
        targetedPersonas.push(persona.name)
        console.log(`🎯 Direct targeting detected: ${persona.name} (${nameMatch ? 'name' : initialsMatch ? 'initials' : 'role'})`)
      }
    }

    // Determine intent with enhanced logic
    let intent: "targeted" | "general" | "follow_up" = "general"
    let confidence = 0.7
    let reasoning = "Default general classification"

    if (targetedPersonas.length > 0) {
      intent = "targeted"
      confidence = 0.95
      reasoning = `Direct targeting of: ${targetedPersonas.join(', ')}`
    } else if (this.isFollowUpQuestion(messageContent, state)) {
      intent = "follow_up"
      confidence = 0.85
      reasoning = "Follow-up question detected with previous speaker context"
    } else if (messageContent.length < 20 && !this.hasRoleKeywords(messageContent, state.registeredPersonas)) {
      intent = "general"
      confidence = 0.9
      reasoning = "Short general question requiring multiple perspectives"
    }

    // Enhanced AI analysis with robust parsing
    let topic = "general_inquiry"
    let aiReasoning = ""

    try {
      const analysisPrompt = `Analyze this student interview question:

QUESTION: "${latestMessage.content}"
AVAILABLE PERSONAS: ${state.registeredPersonas.map(p => `${p.name} (${p.role})`).join(', ')}
CONVERSATION SUMMARY: ${state.conversationSummary}

Determine the main topic and provide structured analysis.
Format your response as: TOPIC:[single_word] | GENERAL:[yes/no] | REASONING:[brief_explanation]

Question: "${latestMessage.content}"`

      const response = await cohere.chat({
        model: 'command-r-plus',
        message: analysisPrompt,
        maxTokens: 120,
        temperature: 0.2,
      })

      const analysisText = response.text?.trim() || ''

      // Robust parsing with fallbacks
      const topicMatch = analysisText.match(/TOPIC:\s*([^\|]+)/)
      const generalMatch = analysisText.match(/GENERAL:\s*([^\|]+)/)
      const reasoningMatch = analysisText.match(/REASONING:\s*(.+)/)

      if (topicMatch) {
        topic = topicMatch[1].trim().toLowerCase()
      }

      if (generalMatch && generalMatch[1].trim().toLowerCase() === 'yes' && intent === "general") {
        confidence = Math.max(confidence, 0.85)
        reasoning += " | AI confirmed as general multi-perspective question"
      }

      if (reasoningMatch) {
        aiReasoning = reasoningMatch[1].trim()
      }

    } catch (error) {
      console.error('AI analysis failed, using heuristics:', error)
      // Fallback to heuristic analysis
      topic = this.extractTopicHeuristic(messageContent)
    }

    // Determine collaboration goal if this is a collaborative question
    let collaborationGoal: string | undefined
    if (targetedPersonas.length === 0 && (intent === "general" || this.isCollaborationPrompt(latestMessage.content))) {
      collaborationGoal = this.extractCollaborationGoal(latestMessage.content)
      console.log(`🎯 Collaboration goal identified: ${collaborationGoal}`)
    }

    const analysisResult = {
      intent,
      targetPersonas: targetedPersonas,
      topic,
      confidence,
      reasoning: `${reasoning} | AI: ${aiReasoning}`,
      collaborationGoal
    }

    // Update conversation summary for long-term memory
    const updatedSummary = await this.updateConversationSummary(state, latestMessage.content, analysisResult)

    return {
      nextNode: 'route_to_personas',
      shouldContinue: true,
      updatedState: {
        ...state,
        conversationContext: `Intent: ${intent}, Topic: ${topic}, Confidence: ${confidence}`,
        conversationSummary: updatedSummary,
        analysisResult,
        lastAction: 'analyze_input_complete'
      }
    }
  }

  private extractTopicHeuristic(content: string): string {
    const topicKeywords = {
      'safety': ['safety', 'safe', 'risk', 'danger', 'accident'],
      'communication': ['talk', 'speak', 'communicate', 'discuss', 'conversation'],
      'teamwork': ['team', 'collaborate', 'together', 'group', 'cooperation'],
      'leadership': ['lead', 'manage', 'supervise', 'direct', 'guide'],
      'training': ['learn', 'teach', 'train', 'education', 'skill'],
      'process': ['process', 'procedure', 'workflow', 'method', 'approach']
    }

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => content.includes(keyword))) {
        return topic
      }
    }
    return 'general_inquiry'
  }

  private async updateConversationSummary(state: AgentState, newMessage: string, analysis: any): Promise<string> {
    // Simple summary update - in production, use AI to maintain context
    const recentTopics = [analysis.topic]
    if (state.conversationSummary) {
      const existingTopics = state.conversationSummary.split(', ')
      recentTopics.push(...existingTopics.slice(0, 3)) // Keep last 3 topics
    }
    return [...new Set(recentTopics)].join(', ')
  }

  private hasRoleKeywords(content: string, personas: Persona[]): boolean {
    const roleKeywords = personas.flatMap(p =>
      p.role.toLowerCase().split(/\s+/).filter(word => word.length > 3)
    )
    return roleKeywords.some(keyword => content.includes(keyword))
  }

  private isFollowUpQuestion(content: string, state: AgentState): boolean {
    const followUpIndicators = ['what about', 'can you explain', 'tell me more', 'why', 'how', 'what do you mean']
    return followUpIndicators.some(indicator => content.includes(indicator)) &&
           state.currentSpeaker !== null
  }

  // Enhanced routing with full instructor configuration integration
  // FIXED VERSION: Enhanced routing with proper single-persona handling
private async routeToPersonasNode(state: AgentState): Promise<NodeResult> {
  console.log('🎯 Routing personas based on analysis and instructor config:', state.analysisResult)

  const analysis = state.analysisResult
  const config = state.instructorConfig
  let selectedPersonas: Persona[] = []

  // INSTRUCTOR OVERRIDE: Require all personas mode
  if (config.requireAllPersonas) {
    selectedPersonas = [...state.registeredPersonas]
    console.log('🎓 Instructor config: ALL personas must respond')
  } else if (!analysis) {
    selectedPersonas = [state.registeredPersonas[state.turnCount % state.registeredPersonas.length]]
  } else {
    switch (analysis.intent) {
      case "targeted":
        selectedPersonas = state.registeredPersonas.filter(p =>
          analysis.targetPersonas.includes(p.name)
        )
        console.log(`✅ Targeted selection: ${selectedPersonas.map(p => p.name).join(', ')}`)
        break

      case "follow_up":
        if (state.currentSpeaker) {
          const currentPersona = state.registeredPersonas.find(p => p.name === state.currentSpeaker)
          if (currentPersona) {
            selectedPersonas = [currentPersona]
            console.log(`✅ Follow-up locked to current speaker: ${state.currentSpeaker}`)

            const others = state.registeredPersonas.filter(p =>
              p.name !== state.currentSpeaker &&
              !state.previouslyEngagedPersonas.slice(-1).includes(p.name)
            )
            if (others.length > 0 && Math.random() > 0.6) {
              selectedPersonas.push(others[0])
              console.log(`✅ Added secondary speaker: ${others[0].name}`)
            }
          }
        }
        break

      case "general":
        selectedPersonas = this.selectForGeneralQuestion(state, analysis)
        console.log(`✅ General question selection: ${selectedPersonas.map(p => p.name).join(', ')}`)
        break
    }
  }

  // INSTRUCTOR OVERRIDE: Forced persona order
  if (config.forcedPersonaOrder && config.forcedPersonaOrder.length > 0) {
    const orderedPersonas = config.forcedPersonaOrder
      .map(name => state.registeredPersonas.find(p => p.name === name))
      .filter((p): p is Persona => p !== undefined)

    if (orderedPersonas.length > 0) {
      const currentIndex = state.turnCount % orderedPersonas.length
      selectedPersonas = [orderedPersonas[currentIndex]]
      console.log(`🎓 Instructor forced order: ${selectedPersonas[0].name} (position ${currentIndex})`)
    }
  }

  // BUG FIX: Handle single persona case differently
  if (state.registeredPersonas.length === 1) {
    // For single persona, always select that persona but clear current speaker to allow response
    selectedPersonas = [state.registeredPersonas[0]]
    console.log('🔧 Single persona mode: allowing response from only available persona')

    // Update turn history
    const updatedTurnHistory = { ...state.personaTurnHistory }
    selectedPersonas.forEach(persona => {
      updatedTurnHistory[persona.name] = (updatedTurnHistory[persona.name] || 0) + 1
    })

    return {
      nextNode: 'generate_responses',
      shouldContinue: true,
      updatedState: {
        ...state,
        engagedPersonas: selectedPersonas,
        personaTurnHistory: updatedTurnHistory,
        currentSpeaker: null, // CRITICAL: Clear current speaker to allow response generation
        lastAction: `routed_to_single_persona_${selectedPersonas[0].name}`
      }
    }
  }

  // MULTI-PERSONA FIX: Prevent same persona from speaking multiple times in same turn
  selectedPersonas = selectedPersonas.filter(p => p.name !== state.currentSpeaker)

  // If we filtered out everyone in multi-persona scenario, add back one persona (but not the current speaker)
  if (selectedPersonas.length === 0) {
    const availablePersonas = state.registeredPersonas.filter(p => p.name !== state.currentSpeaker)
    if (availablePersonas.length > 0) {
      selectedPersonas = [availablePersonas[0]]
      console.log(`⚠️ Fallback selection applied (avoiding current speaker: ${state.currentSpeaker})`)
    } else {
      // This should not happen in multi-persona scenario, but handle gracefully
      selectedPersonas = [state.registeredPersonas[0]]
      console.log('⚠️ Edge case fallback: using first available persona')
    }
  }

  // Update turn history
  const updatedTurnHistory = { ...state.personaTurnHistory }
  selectedPersonas.forEach(persona => {
    updatedTurnHistory[persona.name] = (updatedTurnHistory[persona.name] || 0) + 1
  })

  return {
    nextNode: 'generate_responses',
    shouldContinue: true,
    updatedState: {
      ...state,
      engagedPersonas: selectedPersonas,
      personaTurnHistory: updatedTurnHistory,
      lastAction: `routed_to_${selectedPersonas.length}_personas`
    }
  }
}

  private selectForGeneralQuestion(state: AgentState, analysis: any): Persona[] {
    const config = state.instructorConfig

    // INSTRUCTOR OVERRIDE: If requireAllPersonas is true, return all
    if (config.requireAllPersonas) {
      return [...state.registeredPersonas]
    }

    // Enhanced selection considering turn history and topic relevance
    const available = state.registeredPersonas.map(persona => {
      let score = 1.0

      // CRITICAL FIX: Strong penalty for current speaker to prevent same-turn repetition
      if (persona.name === state.currentSpeaker) {
        score -= 0.8
        console.log(`⚠️ Penalizing current speaker ${persona.name} to prevent repetition`)
      }

      // ENHANCED: Penalize recent speakers more heavily to avoid repetition
      if (state.previouslyEngagedPersonas.slice(-2).includes(persona.name)) {
        score -= 0.6 // Stronger penalty for recent speakers
      }
      if (state.previouslyEngagedPersonas.slice(-1).includes(persona.name)) {
        score -= 0.4 // Additional penalty for immediate previous speaker
      }

      // ENHANCED: Boost underused personas significantly
      const turnCount = state.personaTurnHistory[persona.name] || 0
      const avgTurns = Object.values(state.personaTurnHistory).reduce((a, b) => a + b, 0) /
        Math.max(Object.keys(state.personaTurnHistory).length, 1) // Avoid division by zero

      if (turnCount < avgTurns * 0.8) { // Less than 80% of average
        score += 0.5 // Strong boost for underused personas
        console.log(`✅ Boosting underused persona ${persona.name} (${turnCount} vs avg ${avgTurns.toFixed(1)})`)
      }

      // Topic relevance boost
      const relevanceText = `${persona.role} ${persona.goal} ${persona.concerns}`.toLowerCase()
      if (relevanceText.includes(analysis.topic.toLowerCase())) {
        score += 0.5 // Increased relevance boost
      }

      return { persona, score }
    })

    // Return top scorers (2-3 for general questions, ensuring variety)
    const sorted = available.sort((a, b) => b.score - a.score)
    const count = Math.min(3, Math.max(2, Math.floor(analysis.confidence * 3)))

    // Filter out personas with negative scores (heavily penalized)
    const validPersonas = sorted.filter(item => item.score > 0)

    return validPersonas.slice(0, count).map(item => item.persona)
  }

  // NEW: Generate collaborative response that builds on teammates' input
  private async generateCollaborativeResponse(
    persona: Persona,
    studentMessage: Message,
    state: AgentState,
    priorReplies: string,
    isFirstSpeaker: boolean,
    collaborationGoal: string,
    consensusItems: string[],
    shouldChallenge: boolean = false
  ): Promise<PersonaResponse> {
    const config = state.instructorConfig

    // Adaptive conversation history
    const historyLength = config.summaryInterval ? Math.min(8, config.summaryInterval) : 8
    const conversationHistory = state.messages.slice(-historyLength)
    const historyText = conversationHistory
      .map(msg => `${msg.sender === 'student' ? 'Student' : msg.personaName}: ${msg.content}`)
      .join('\n')

    // Enhanced confidence calculation
    const analysis = state.analysisResult
    let baseConfidence = 0.85 // Higher base for collaborative mode

    if (analysis?.intent === "targeted" && analysis.targetPersonas.includes(persona.name)) {
      baseConfidence = 0.95
    } else if (analysis?.topic) {
      const relevanceText = `${persona.role} ${persona.goal} ${persona.concerns}`.toLowerCase()
      if (relevanceText.includes(analysis.topic.toLowerCase())) {
        baseConfidence = 0.9
      }
    }

    // Build consensus context
    const consensusContext = consensusItems.length > 0 ?
      `\nEMERGING TEAM CONSENSUS: ${consensusItems.join(', ')}` : ''

    // ENHANCED: Collaborative-specific instructions with clear shared goal
    const sharedGoalInstruction = `SHARED TEAM GOAL: The team must produce a unified ${collaborationGoal.replace('_', ' ')} recommendation.`

    const collaborationInstruction = isFirstSpeaker ?
      `- You are starting a team discussion to achieve: ${collaborationGoal.replace('_', ' ')}
- Present your initial perspective clearly and specifically
- Set up the foundation for your teammates to build upon
- Be specific about your role's unique viewpoint and recommendations` :

      shouldChallenge ?
      `- Your teammates have shared their thoughts (see below)
- You may respectfully challenge or offer alternatives to their suggestions
- Provide constructive criticism and propose better solutions
- Reference what others said specifically (e.g., "I disagree with [Name] about X because...")
- Work toward a better collaborative solution` :

      `- Your teammates have already shared their thoughts (see below)
- Build on their ideas - don't just repeat what they said
- Add your unique perspective, clarify points, or extend their suggestions
- Reference what others said when relevant (e.g., "Building on [Name]'s point about...")
- Help the team reach consensus on ${collaborationGoal.replace('_', ' ')}`

    // Personality and length instructions
    const personalityInstruction = config.personalityEmphasis ?
      `- Your personality trait of "${persona.personality}" should influence how you collaborate and negotiate
- Let your "${persona.personality}" nature shape how you interact with teammates` :
      `- Show your personality trait of "${persona.personality}" in how you collaborate`

    const lengthInstruction = config.maxResponseLength ?
      `- Keep your response under ${config.maxResponseLength} characters` :
      `- Keep responses 2-4 sentences for natural team discussion flow`

    const prompt = `You are ${persona.name}, a ${persona.role}, participating in a COLLABORATIVE TEAM DISCUSSION.

YOUR CHARACTERISTICS:
ROLE: ${persona.role}
GOAL: ${persona.goal}
CONCERNS: ${persona.concerns}
PERSONALITY: ${persona.personality}

${sharedGoalInstruction}
CONTEXT: ${state.conversationContext}
STUDENT'S QUESTION: ${studentMessage.content}
${consensusContext}

${priorReplies ? `TEAMMATES' RESPONSES SO FAR:
${priorReplies}

` : ''}COLLABORATION INSTRUCTIONS:
${collaborationInstruction}
${personalityInstruction}
${lengthInstruction}

CRITICAL RULES:
- Stay completely in character as ${persona.name}
- NEVER mention you are an AI, language model, or chatbot
- This is a real team discussion - interact naturally with your colleagues
- The team must reach a specific conclusion about ${collaborationGoal.replace('_', ' ')}
- Feel free to ask questions, challenge ideas constructively, or build consensus
- Only claim to have "discussed with colleagues" if teammates actually spoke before you
- Be conversational and show how your role adds unique value to the team decision

CONVERSATION HISTORY:
${historyText}

Respond as ${persona.name} in this collaborative team discussion, working toward the shared goal:`

    // Adjust temperature for natural collaboration
    const temperature = config.personalityEmphasis ? 0.85 : 0.8
    const maxTokens = config.maxResponseLength ?
      Math.min(300, Math.floor(config.maxResponseLength / 4)) : 250

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens,
      temperature,
    })

    let content = response.text?.trim() || this.getFallbackResponse(persona, studentMessage.content)

    // Enforce max length if specified
    if (config.maxResponseLength && content.length > config.maxResponseLength) {
      content = content.substring(0, config.maxResponseLength - 3) + '...'
      console.log(`✂️ Truncated ${persona.name} collaborative response to ${config.maxResponseLength} chars`)
    }

    // Enhanced confidence adjustment for collaboration
    let finalConfidence = baseConfidence
    if (this.isOutOfCharacter(content)) {
      finalConfidence *= 0.2
    } else if (content.length < 20) {
      finalConfidence *= 0.6
    } else {
      // Bonus for true collaborative language
      const collaborativeWords = ['agree', 'disagree', 'build on', 'add to', 'like you said', 'building on', 'i think', 'but', 'however', 'let me add']
      const questionWords = ['what do you think', 'how about', 'would you', 'should we']
      const referenceWords = [persona.name !== 'Unknown' ? state.engagedPersonas.filter(p => p.name !== persona.name).map(p => p.name.toLowerCase()) : []].flat()

      let collaborationBonus = 1.0
      if (!isFirstSpeaker) {
        if (collaborativeWords.some(word => content.toLowerCase().includes(word))) {
          collaborationBonus += 0.15 // Boost for collaborative language
        }
        if (questionWords.some(word => content.toLowerCase().includes(word))) {
          collaborationBonus += 0.1 // Boost for asking questions
        }
        if (referenceWords.some(name => content.toLowerCase().includes(name))) {
          collaborationBonus += 0.2 // Big boost for referencing teammates by name
        }
      }

      finalConfidence *= collaborationBonus

      if (config.personalityEmphasis && content.toLowerCase().includes(persona.personality.toLowerCase())) {
        finalConfidence *= 1.1
      }
    }

    return {
      personaName: persona.name,
      content,
      agentId: persona.name,
      confidence: Math.min(0.99, Math.round(finalConfidence * 100) / 100),
      reasoning: `Collaborative response as ${persona.role} (${isFirstSpeaker ? 'initiating' : shouldChallenge ? 'challenging teammates' : 'building on teammates'}), confidence: ${Math.round(finalConfidence * 100)}%`
    }
  }

  // Enhanced response generation with instructor configuration
  // Enhanced response generation with instructor configuration (for non-collaborative responses)
private async generateResponsesNode(state: AgentState): Promise<NodeResult> {
  console.log('💬 Generating individual responses from personas:', state.engagedPersonas.map(p => p.name))

  const responses: PersonaResponse[] = []
  const latestMessage = state.messages[state.messages.length - 1]

  // CRITICAL FIX: Different logic for single vs multi-persona scenarios
  let eligiblePersonas: Persona[]

  if (state.registeredPersonas.length === 1) {
    // Single persona: always allow the only persona to respond
    eligiblePersonas = state.engagedPersonas
    console.log('🔧 Single persona mode: allowing only available persona to respond')
  } else {
    // Multi-persona: filter out current speaker to prevent multiple replies in same turn
    eligiblePersonas = state.engagedPersonas.filter(persona => {
      if (persona.name === state.currentSpeaker) {
        console.log(`🚫 Skipping ${persona.name} - already current speaker`)
        return false
      }
      return true
    })
  }

  for (const persona of eligiblePersonas) {
    try {
      const response = await this.generatePersonaResponse(persona, latestMessage, state)
      responses.push(response)
    } catch (error) {
      console.error(`Failed to generate response for ${persona.name}:`, error)
      responses.push({
        personaName: persona.name,
        content: this.getFallbackResponse(persona, latestMessage.content),
        agentId: persona.name,
        confidence: 0.3,
        reasoning: 'Fallback due to generation error'
      })
    }
  }

  // If no responses generated in multi-persona scenario, get one different persona
  if (responses.length === 0 && state.registeredPersonas.length > 1) {
    const alternativePersona = state.registeredPersonas.find(p => p.name !== state.currentSpeaker)
    if (alternativePersona) {
      console.log(`⚠️ No eligible personas, using alternative: ${alternativePersona.name}`)
      const response = await this.generatePersonaResponse(alternativePersona, latestMessage, state)
      responses.push(response)
    }
  }

  // Add responses to state as new messages
  const newMessages = responses.map(resp => ({
    id: `${Date.now()}-${resp.personaName}`,
    sender: 'persona' as const,
    personaName: resp.personaName,
    content: resp.content,
    timestamp: new Date(),
    metadata: { confidence: resp.confidence, reasoning: resp.reasoning }
  }))

  // Update engagement tracking
  const newlyEngaged = responses.map(r => r.personaName)
  const updatedPreviouslyEngaged = [
    ...state.previouslyEngagedPersonas,
    ...newlyEngaged
  ].slice(-8)

  return {
    nextNode: 'validate_responses',
    shouldContinue: true,
    responses,
    updatedState: {
      ...state,
      messages: [...state.messages, ...newMessages],
      currentSpeaker: responses.length === 1 ? responses[0].personaName : null,
      turnCount: state.turnCount + 1,
      previouslyEngagedPersonas: updatedPreviouslyEngaged,
      lastAction: 'responses_generated'
    }
  }
}

  // Enhanced validation with stricter confidence checks
  private async validateResponsesNode(state: AgentState): Promise<NodeResult> {
    console.log('✅ Validating response quality')

    const recentPersonaMessages = state.messages
      .filter(msg => msg.sender === 'persona')
      .slice(-state.engagedPersonas.length)

    let allValid = true
    let validationReason = ''

    // Enhanced validation checks
    for (const message of recentPersonaMessages) {
      if (message.content.length < 15) {
        allValid = false
        validationReason = 'Response too short'
        break
      }

      if (this.isOutOfCharacter(message.content)) {
        allValid = false
        validationReason = 'Out of character response detected'
        break
      }

      // Use analysis confidence in validation
      const analysisConfidence = state.analysisResult?.confidence || 0.5
      const responseConfidence = message.metadata?.confidence || 0.5
      const combinedConfidence = (analysisConfidence + responseConfidence) / 2

      if (combinedConfidence < 0.5) {
        allValid = false
        validationReason = `Low combined confidence: ${combinedConfidence.toFixed(2)}`
        break
      }

      if (message.content.includes('error') || message.content.includes('failed')) {
        allValid = false
        validationReason = 'Error content detected'
        break
      }
    }

    return {
      nextNode: allValid ? 'format_output' : 'generate_responses',
      shouldContinue: true,
      updatedState: {
        ...state,
        lastAction: allValid ? 'validation_passed' : `validation_failed_${validationReason}`
      }
    }
  }

  private async formatOutputNode(state: AgentState): Promise<NodeResult> {
    console.log('📤 Formatting final output')

    const recentPersonaMessages = state.messages
      .filter(msg => msg.sender === 'persona')
      .slice(-state.engagedPersonas.length)

    const responses: PersonaResponse[] = recentPersonaMessages.map(msg => ({
      personaName: msg.personaName || 'Unknown',
      content: msg.content,
      agentId: msg.personaName || 'unknown',
      confidence: msg.metadata?.confidence || 0.8,
      reasoning: msg.metadata?.reasoning
    }))

    return {
      shouldContinue: false,
      responses,
      updatedState: {
        ...state,
        lastAction: 'workflow_complete'
      }
    }
  }

  private async generatePersonaResponse(
    persona: Persona,
    studentMessage: Message,
    state: AgentState
  ): Promise<PersonaResponse> {
    const config = state.instructorConfig

    // Adaptive conversation history based on memory management
    const historyLength = config.summaryInterval ? Math.min(10, config.summaryInterval) : 10
    const conversationHistory = state.messages.slice(-historyLength)
    const historyText = conversationHistory
      .map(msg => `${msg.sender === 'student' ? 'Student' : msg.personaName}: ${msg.content}`)
      .join('\n')

    // Enhanced confidence calculation
    const analysis = state.analysisResult
    let baseConfidence = 0.7

    if (analysis?.intent === "targeted" && analysis.targetPersonas.includes(persona.name)) {
      baseConfidence = 0.95
    } else if (analysis?.topic) {
      const relevanceText = `${persona.role} ${persona.goal} ${persona.concerns}`.toLowerCase()
      if (relevanceText.includes(analysis.topic.toLowerCase())) {
        baseConfidence = 0.85
      }
    }

    // ENHANCED PERSONALITY EMPHASIS: Stronger personality instructions
    const personalityInstruction = config.personalityEmphasis ?
      `- CRITICAL: Your personality trait of "${persona.personality}" must strongly influence your tone, word choice, and approach
- Make sure your personality trait "${persona.personality}" shows in how you speak, your phrasing, and emotional tone
- For example, if you're cautious, hedge your statements. If bold, make confident assertions
- Let your "${persona.personality}" nature be evident in every sentence you write
- Your communication style should reflect your personality prominently` :
      `- Reflect your personality trait of "${persona.personality}" in your tone and approach`

    // INSTRUCTOR CONFIG: Response length control
    const lengthInstruction = config.maxResponseLength ?
      `- Keep your response under ${config.maxResponseLength} characters
- Be concise while maintaining your personality and role authenticity` :
      `- Keep responses 2-4 sentences for natural conversation flow`

    const prompt = `You are ${persona.name}, a ${persona.role}. Here are your characteristics:

ROLE: ${persona.role}
GOAL: ${persona.goal}
CONCERNS: ${persona.concerns}
PERSONALITY: ${persona.personality}

CONTEXT: ${state.conversationContext}
CONVERSATION THEMES: ${state.conversationSummary}

CRITICAL INSTRUCTIONS:
- Stay completely in character as ${persona.name}
- NEVER mention you are an AI, language model, or chatbot
- Speak as if you are a real person in this role
${personalityInstruction}
- Draw from your specific goals, concerns, and personality when responding
- Be conversational and natural, showing your unique perspective
- Provide specific examples from your work experience when relevant
- DO NOT claim to have "discussed with colleagues" unless there are actual prior responses from teammates in this conversation
${lengthInstruction}

CONVERSATION HISTORY:
${historyText}

CURRENT QUESTION: ${studentMessage.content}

Respond as ${persona.name} would, fully embodying your role and personality:`

    // INSTRUCTOR CONFIG: Adjust temperature for personality emphasis
    const temperature = config.personalityEmphasis ? 0.85 : 0.75
    const maxTokens = config.maxResponseLength ?
      Math.min(300, Math.floor(config.maxResponseLength / 4)) : 300

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: prompt,
      maxTokens,
      temperature,
    })

    let content = response.text?.trim() || this.getFallbackResponse(persona, studentMessage.content)

    // INSTRUCTOR CONFIG: Enforce max length if specified
    if (config.maxResponseLength && content.length > config.maxResponseLength) {
      content = content.substring(0, config.maxResponseLength - 3) + '...'
      console.log(`✂️ Truncated ${persona.name} response to ${config.maxResponseLength} chars`)
    }

    // ENHANCED: Personality verification and confidence adjustment
    let finalConfidence = baseConfidence
    if (this.isOutOfCharacter(content)) {
      finalConfidence *= 0.2
    } else if (content.length < 20) {
      finalConfidence *= 0.6
    } else {
      // CRITICAL FIX: Check for personality presence in response
      const personalityWords = persona.personality.toLowerCase().split(/\s+/)
      const personalityPresent = personalityWords.some(word =>
        content.toLowerCase().includes(word) ||
        this.getPersonalityRelatedWords(persona.personality).some(related =>
          content.toLowerCase().includes(related)
        )
      )

      if (config.personalityEmphasis) {
        if (personalityPresent) {
          finalConfidence *= 1.2 // Higher boost for personality emphasis mode
        } else {
          finalConfidence *= 0.85 // Penalty if personality not evident
          console.log(`⚠️ Personality "${persona.personality}" not evident in ${persona.name}'s response`)
        }
      } else if (personalityPresent) {
        finalConfidence *= 1.1 // Standard personality boost
      }
    }

    return {
      personaName: persona.name,
      content,
      agentId: persona.name,
      confidence: Math.min(0.99, Math.round(finalConfidence * 100) / 100),
      reasoning: `Generated as ${persona.role} with personality "${persona.personality}"${config.personalityEmphasis ? ' (EMPHASIZED)' : ''}, confidence: ${Math.round(finalConfidence * 100)}%`
    }
  }

  // Helper function to get personality-related words for better detection
  private getPersonalityRelatedWords(personality: string): string[] {
    const personalityMap: Record<string, string[]> = {
      'cautious': ['careful', 'hesitant', 'concerned', 'worried', 'prudent', 'conservative'],
      'bold': ['confident', 'assertive', 'direct', 'strong', 'definitive', 'certain'],
      'practical': ['realistic', 'pragmatic', 'hands-on', 'efficient', 'logical', 'straightforward'],
      'analytical': ['detailed', 'thorough', 'systematic', 'methodical', 'precise', 'data-driven'],
      'creative': ['innovative', 'imaginative', 'flexible', 'adaptable', 'original', 'inventive'],
      'supportive': ['helpful', 'encouraging', 'collaborative', 'understanding', 'patient', 'kind'],
      'detail-oriented': ['specific', 'precise', 'thorough', 'meticulous', 'exact', 'comprehensive'],
      'enthusiastic': ['excited', 'energetic', 'passionate', 'motivated', 'eager', 'positive']
    }

    const lowerPersonality = personality.toLowerCase()
    for (const [key, words] of Object.entries(personalityMap)) {
      if (lowerPersonality.includes(key)) {
        return words
      }
    }
    return []
  }

  private getFallbackResponse(persona: Persona, message: string): string {
    const personalityBasedFallbacks = [
      `As a ${persona.role}, I approach this with my ${persona.personality} perspective...`,
      `That's an interesting question. Given my ${persona.personality} nature and role as a ${persona.role}...`,
      `Let me share how this connects to what I focus on: ${persona.goal.substring(0, 60)}...`,
      `This touches on something I think about often in my work as a ${persona.role}...`
    ]
    return personalityBasedFallbacks[Math.floor(Math.random() * personalityBasedFallbacks.length)]
  }

  // Execute the enhanced workflow
  async execute(initialState: AgentState): Promise<PersonaResponse[]> {
    let currentState = initialState
    let currentNode = 'analyze_input'
    let iterations = 0
    const maxIterations = 15 // Increased for retry logic

    while (iterations < maxIterations) {
      console.log(`🔄 Executing node: ${currentNode} (iteration ${iterations + 1})`)

      const nodeFunction = this.nodes.get(currentNode)
      if (!nodeFunction) {
        console.error(`Node ${currentNode} not found`)
        break
      }

      const result = await nodeFunction(currentState)
      currentState = result.updatedState

      if (!result.shouldContinue) {
        console.log('✅ Workflow complete')
        return result.responses || []
      }

      // Enhanced next node determination
      if (result.nextNode) {
        currentNode = result.nextNode
      } else {
        const conditionalLogic = this.conditionalEdges.get(currentNode)
        if (conditionalLogic) {
          currentNode = conditionalLogic(currentState)
        } else {
          const possibleEdges = this.edges.get(currentNode)
          if (possibleEdges && possibleEdges.length > 0) {
            currentNode = possibleEdges[0]
          } else {
            console.log('No more nodes to execute')
            break
          }
        }
      }

      iterations++
    }

    console.warn('Workflow reached max iterations')
    return []
  }
}

export async function POST(req: Request) {
  try {
    const { message, personas, conversationHistory, sessionId, instructorConfig }: RequestBody = await req.json()

    if (!message || !personas || personas.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    console.log('=== ENHANCED LANGGRAPH INTERVIEW SESSION ===')
    console.log('Student message:', message)
    console.log('Registered personas:', personas.map(p => `${p.name} (${p.initials}) - ${p.personality}`))
    console.log('Session ID:', sessionId || 'new')
    console.log('Instructor config:', instructorConfig)

    // Create student message
    const studentMessage: Message = {
      id: `${Date.now()}-student`,
      sender: 'student',
      content: message,
      timestamp: new Date()
    }

    // Initialize enhanced workflow state with instructor config
    const previousPersonaTurns: Record<string, number> = {}
    conversationHistory?.forEach(msg => {
      if (msg.sender === 'persona' && msg.personaName) {
        previousPersonaTurns[msg.personaName] = (previousPersonaTurns[msg.personaName] || 0) + 1
      }
    })

    const initialState: AgentState = {
      messages: [...(conversationHistory || []), studentMessage],
      currentSpeaker: conversationHistory?.slice(-1).find(msg => msg.sender === 'persona')?.personaName || null,
      conversationContext: '',
      conversationSummary: '',
      registeredPersonas: personas, // Full roster never mutated
      engagedPersonas: [], // Separate engaged list
      sessionId: sessionId || `session-${Date.now()}`,
      turnCount: conversationHistory?.length || 0,
      lastAction: 'workflow_started',
      previouslyEngagedPersonas: conversationHistory
        ?.filter(msg => msg.sender === 'persona' && msg.personaName)
        .slice(-6)
        .map(msg => msg.personaName!) || [],
      personaTurnHistory: previousPersonaTurns,
      collaborativeGoals: {}, // Track team consensus
      instructorConfig: {
        requireAllPersonas: false,
        maxResponseLength: undefined,
        forcedPersonaOrder: undefined,
        personalityEmphasis: false,
        summaryInterval: 20,
        ...instructorConfig // Override with provided config
      }
    }

    // Execute enhanced workflow
    const workflow = new InterviewWorkflow()
    const responses = await workflow.execute(initialState)

    console.log('Generated responses:', responses.length)
    console.log('Quality metrics:', responses.map(r =>
      `${r.personaName}: ${r.confidence} confidence`
    ))

    return NextResponse.json({
      responses: responses.map(r => ({
        personaName: r.personaName,
        content: r.content,
        agentId: r.agentId,
        confidence: r.confidence
      })),
      metadata: {
        totalPersonas: personas.length,
        respondingPersonas: responses.length,
        conversationLength: initialState.messages.length,
        sessionId: initialState.sessionId,
        workflowComplete: true,
        analysisResult: initialState.analysisResult,
        qualityScores: responses.map(r => r.confidence),
        turnHistory: initialState.personaTurnHistory,
        collaborativeGoals: initialState.collaborativeGoals, // Include consensus tracking
        instructorConfig: initialState.instructorConfig, // Include config in response
        debugInfo: {
          routing: responses.map(r => r.reasoning),
          previousSpeakers: initialState.previouslyEngagedPersonas,
          currentSpeaker: initialState.currentSpeaker,
          collaborationDetected: responses.some(r => r.reasoning?.includes('Collaborative')),
          hasCollaborationSummary: responses.some(r => r.agentId === 'team-summary'),
          memoryManagement: {
            summaryInterval: initialState.instructorConfig.summaryInterval,
            shouldSummarize: initialState.turnCount > 0 &&
              initialState.turnCount % (initialState.instructorConfig.summaryInterval || 20) === 0
          }
        }
      }
    })

  } catch (error) {
    console.error('Enhanced Interview API error:', error)

    return NextResponse.json(
      {
        error: 'Failed to process interview message',
        responses: [{
          personaName: 'System',
          content: 'I apologize, but there was an error processing your message. Please try again.',
          agentId: 'system',
          confidence: 0.1
        }]
      },
      { status: 500 }
    )
  }
}