'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Navigation } from '../components/Navigation'

interface Persona {
  name: string
  initials: string
  role: string
  goal: string
  concerns: string
  personality: string
}

interface Message {
  id: string
  sender: 'student' | 'persona'
  personaName?: string
  content: string
  timestamp: Date
}

interface InterviewSession {
  id: string
  selectedPersonas: Persona[]
  messages: Message[]
  startTime: Date
  isActive: boolean
}

export default function InterviewPage() {
  const [availablePersonas, setAvailablePersonas] = useState<Persona[]>([])
  const [selectedPersonas, setSelectedPersonas] = useState<Persona[]>([])
  const [currentSession, setCurrentSession] = useState<InterviewSession | null>(null)
  const [message, setMessage] = useState('')
  const [isGeneratingRequirements, setIsGeneratingRequirements] = useState(false)
  const [requirements, setRequirements] = useState<string | null>(null)
  const [transcriptDownloaded, setTranscriptDownloaded] = useState(false)
  const [projectData, setProjectData] = useState<any>(null)
  const [personaData, setPersonaData] = useState<any>(null)
  const [showProjectDetails, setShowProjectDetails] = useState(true)

  // NEW: Text selection state
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)

  const router = useRouter()

  useEffect(() => {
    // Load personas and project data from previous generation
    const raw = sessionStorage.getItem('personas')
    const projectRaw = sessionStorage.getItem('originalRequest')

    if (!raw) {
      router.push('/')
      return
    }

    try {
      const data = JSON.parse(raw)
      console.log('Loaded persona data:', data) // Debug log

      const personas = Array.isArray(data) ? data : (data.personas || [])
      setAvailablePersonas(personas)

      // Make sure we're setting the full data object which includes projectOutline
      if (!Array.isArray(data)) {
        setPersonaData(data)
      }

      if (projectRaw) {
        const projectInfo = JSON.parse(projectRaw)
        console.log('Loaded project data:', projectInfo) // Debug log
        setProjectData(projectInfo)
      }
    } catch (error) {
      console.error('Error loading data:', error)
      router.push('/')
    }
  }, [router])

  // Helper function to save session data
  const saveSessionData = async (
    session: InterviewSession,
    status: 'active' | 'completed' | 'abandoned' = 'active',
    requirementsExtracted: boolean = false,
    transcriptDownloaded: boolean = false
  ) => {
    try {
      const projectData = sessionStorage.getItem('originalRequest')
      const personaDataRaw = sessionStorage.getItem('personas')
      const projectName = projectData ? JSON.parse(projectData).projectName : 'Unknown Project'

      // Extract project requirements from persona data
      let projectRequirements: string[] = []
      if (personaDataRaw) {
        try {
          const personaData = JSON.parse(personaDataRaw)
          if (personaData.requirements && Array.isArray(personaData.requirements)) {
            projectRequirements = personaData.requirements
          }
        } catch (e) {
          console.error('Error parsing persona data for requirements:', e)
        }
      }

      // Generate a student name (in production, this would come from login)
      const studentName = `Student_${session.id.slice(-6)}`

      const sessionData = {
        sessionId: session.id,
        projectName,
        studentName,
        startTime: session.startTime,
        endTime: status !== 'active' ? new Date() : undefined,
        messages: session.messages,
        personasInterviewed: session.selectedPersonas.map(p => p.name),
        status,
        requirementsExtracted,
        transcriptDownloaded,
        // Add metadata with project requirements
        metadata: {
          projectRequirements
        }
      }

      const response = await fetch('/api/session-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData)
      })

      if (response.ok) {
        console.log('Session data saved successfully with requirements')
      }
    } catch (error) {
      console.error('Failed to save session data:', error)
    }
  }

  // NEW: Toggle message selection
  const toggleMessageSelection = (messageId: string) => {
    if (!isSelectionMode) return

    setSelectedMessages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }

  // NEW: Clear all selections
  const clearSelections = () => {
    setSelectedMessages(new Set())
    setIsSelectionMode(false)
  }

  // NEW: Select all messages
  const selectAllMessages = () => {
    if (!currentSession) return
    const allMessageIds = currentSession.messages.map(m => m.id)
    setSelectedMessages(new Set(allMessageIds))
  }

  const handlePersonaToggle = (persona: Persona) => {
    setSelectedPersonas(prev => {
      const isSelected = prev.find(p => p.name === persona.name)
      if (isSelected) {
        return prev.filter(p => p.name !== persona.name)
      } else {
        return [...prev, persona]
      }
    })
  }

  const startInterview = () => {
    if (selectedPersonas.length === 0) {
      alert('Please select at least one persona to interview')
      return
    }

    const session: InterviewSession = {
      id: Date.now().toString(),
      selectedPersonas,
      messages: [],
      startTime: new Date(),
      isActive: true
    }

    setCurrentSession(session)
    setTranscriptDownloaded(false)

    // Add welcome message
    const welcomeMessage: Message = {
      id: Date.now().toString(),
      sender: 'persona',
      personaName: 'System',
      content: `Welcome to your interview session! You are now speaking with: ${selectedPersonas.map(p => p.name + ' (' + p.role + ')').join(', ')}. Feel free to ask questions about requirements, goals, concerns, or anything related to the project.`,
      timestamp: new Date()
    }

    session.messages.push(welcomeMessage)
    setCurrentSession(session)

    // Save initial session state
    saveSessionData(session, 'active', false, false)
  }

  const sendMessage = async () => {
    if (!message.trim() || !currentSession) return

    const studentMessage: Message = {
      id: Date.now().toString(),
      sender: 'student',
      content: message.trim(),
      timestamp: new Date()
    }

    const updatedMessages = [...currentSession.messages, studentMessage]
    setCurrentSession(prev => ({
      ...prev!,
      messages: updatedMessages
    }))

    setMessage('')

    // Send to AI for persona responses
    try {
      const response = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          personas: selectedPersonas,
          conversationHistory: currentSession.messages
        })
      })

      if (!response.ok) throw new Error('Failed to get persona response')

      const { responses } = await response.json()

      // Add persona responses
      const personaMessages: Message[] = responses.map((resp: any, index: number) => ({
        id: (Date.now() + index).toString(),
        sender: 'persona' as const,
        personaName: resp.personaName,
        content: resp.content,
        timestamp: new Date()
      }))

      const finalMessages = [...updatedMessages, ...personaMessages]

      setCurrentSession(prev => {
        const updatedSession = {
          ...prev!,
          messages: finalMessages
        }
        // Save session data after each interaction
        saveSessionData(updatedSession, 'active', !!requirements, transcriptDownloaded)
        return updatedSession
      })

    } catch (error) {
      console.error('Error getting persona response:', error)

      // Fallback response
      const fallbackMessage: Message = {
        id: Date.now().toString(),
        sender: 'persona',
        personaName: selectedPersonas[0].name,
        content: "I apologize, but I'm having trouble responding right now. Please try asking your question again.",
        timestamp: new Date()
      }

      const finalMessages = [...updatedMessages, fallbackMessage]

      setCurrentSession(prev => {
        const updatedSession = {
          ...prev!,
          messages: finalMessages
        }
        saveSessionData(updatedSession, 'active', !!requirements, transcriptDownloaded)
        return updatedSession
      })
    }
  }

  // MODIFIED: Generate requirements with selected messages
  const generateRequirements = async () => {
    if (!currentSession || currentSession.messages.length === 0) {
      alert('No interview session to analyze')
      return
    }

    // Check if in selection mode and have selections
    const messagesToAnalyze = isSelectionMode && selectedMessages.size > 0
      ? currentSession.messages.filter(m => selectedMessages.has(m.id))
      : currentSession.messages

    if (messagesToAnalyze.length === 0) {
      alert('Please select at least one message to analyze')
      return
    }

    setIsGeneratingRequirements(true)

    try {
      const response = await fetch('/api/extract-requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentSession.messages,
          selectedMessageIds: isSelectionMode && selectedMessages.size > 0
            ? Array.from(selectedMessages)
            : undefined,
          personas: selectedPersonas
        })
      })

      if (!response.ok) throw new Error('Failed to generate requirements')

      const { requirements: extractedRequirements } = await response.json()
      setRequirements(extractedRequirements)

      // Update session to mark requirements as extracted
      if (currentSession) {
        await saveSessionData(currentSession, 'active', true, transcriptDownloaded)
      }

      // Clear selections after extraction
      clearSelections()

    } catch (error) {
      console.error('Error generating requirements:', error)
      alert('Error generating requirements. Please try again.')
    } finally {
      setIsGeneratingRequirements(false)
    }
  }

  const downloadRequirements = () => {
    if (!requirements) return

    const blob = new Blob([requirements], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `requirements_${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setTranscriptDownloaded(true)

    // Mark transcript as downloaded
    if (currentSession) {
      saveSessionData(currentSession, 'completed', true, true)
    }
  }

  const endInterview = () => {
    // Save final session state
    if (currentSession) {
      const finalStatus = currentSession.messages.length > 2 ? 'completed' : 'abandoned'
      saveSessionData(currentSession, finalStatus, !!requirements, transcriptDownloaded)
    }

    setCurrentSession(null)
    setSelectedPersonas([])
    setRequirements(null)
    setTranscriptDownloaded(false)
    clearSelections()
  }

  // Auto-save session every 30 seconds while active
  useEffect(() => {
    if (!currentSession || !currentSession.isActive) return

    const interval = setInterval(() => {
      saveSessionData(currentSession, 'active', !!requirements, transcriptDownloaded)
    }, 30000)

    return () => clearInterval(interval)
  }, [currentSession, requirements, transcriptDownloaded])

  if (!currentSession) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Project Details Header - Always show if we have any project info */}
        {(projectData || personaData?.projectOutline || personaData?.metadata) && (
          <div className="bg-white border-b border-gray-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <h1 className="text-2xl font-bold text-gray-900">
                    {projectData?.projectName || 'AlgoTradeSim'}
                  </h1>
                  <p className="text-sm text-gray-600 mt-1">
                    {projectData?.domain || 'Finance'} Domain
                  </p>
                </div>
                <button
                  onClick={() => setShowProjectDetails(!showProjectDetails)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg
                    className={`w-5 h-5 transform transition-transform ${showProjectDetails ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {showProjectDetails && (
                <div className="mt-4 space-y-4">
                  {projectData?.stories && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h3 className="font-medium text-blue-900 mb-2">Project Context</h3>
                      <p className="text-sm text-blue-800">{projectData.stories}</p>
                    </div>
                  )}

                  {personaData?.projectOutline && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <h3 className="font-medium text-gray-900 mb-2">Project Overview</h3>
                      <p className="text-sm text-gray-700 whitespace-pre-line">
                        {personaData.projectOutline}
                      </p>
                      {personaData?.metadata && (
                        <p className="text-xs text-gray-500 mt-2">
                          Based on analysis of {personaData.metadata.reposFound} repositories, {personaData.metadata.readmesProcessed} READMEs processed
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex h-full">
          {/* Persona Selection Sidebar */}
          <div className="w-80 bg-white border-r border-gray-200 p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Select Personas to Interview</h2>
              <p className="text-sm text-gray-600">Choose one or more personas for your interview session</p>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {availablePersonas.map((persona, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedPersonas.find(p => p.name === persona.name)
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => handlePersonaToggle(persona)}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                      {persona.initials}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{persona.name}</h3>
                      <p className="text-sm text-gray-600">{persona.role}</p>
                    </div>
                    <div className="ml-auto">
                      {selectedPersonas.find(p => p.name === persona.name) && (
                        <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{persona.goal}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={startInterview}
                disabled={selectedPersonas.length === 0}
                className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
              >
                Start Interview ({selectedPersonas.length} persona{selectedPersonas.length !== 1 ? 's' : ''})
              </button>

              {/* Use Navigation component */}
              <Navigation showHome={true} showPersonas={true} />
            </div>
          </div>

          {/* Instructions Panel */}
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.959 8.959 0 01-4.906-1.681L3 21l2.909-5.905A8.954 8.954 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Ready to Start Interviewing?</h3>
              <p className="text-gray-600 mb-6">
                Select one or more personas from the sidebar to begin your interview session.
                You can ask about their goals, concerns, requirements, and project needs.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">Interview Tips:</h4>
                <ul className="text-sm text-blue-800 space-y-1 text-left">
                  <li>• Ask open-ended questions about their workflow</li>
                  <li>• Explore their pain points and frustrations</li>
                  <li>• Understand their goals and success metrics</li>
                  <li>• Ask for specific examples and scenarios</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Active Personas Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 p-4">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Active Interview</h2>
          <p className="text-sm text-gray-600">Speaking with {selectedPersonas.length} persona{selectedPersonas.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="space-y-3 mb-6">
          {selectedPersonas.map((persona, index) => (
            <div key={index} className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
                  {persona.initials}
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">{persona.name}</h3>
              </div>
              <p className="text-xs text-gray-600">{persona.role}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {/* NEW: Selection mode toggle */}
          {!isSelectionMode ? (
            <button
              onClick={() => setIsSelectionMode(true)}
              className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 font-medium text-sm"
            >
              ✂️ Select Messages
            </button>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={selectAllMessages}
                  className="flex-1 bg-purple-100 text-purple-700 py-2 px-3 rounded-lg hover:bg-purple-200 font-medium text-sm"
                >
                  Select All
                </button>
                <button
                  onClick={clearSelections}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 px-3 rounded-lg hover:bg-gray-200 font-medium text-sm"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-purple-600 text-center">
                Click messages to select • {selectedMessages.size} selected
              </p>
            </>
          )}

          <button
            onClick={generateRequirements}
            disabled={isGeneratingRequirements || (isSelectionMode && selectedMessages.size === 0)}
            className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium text-sm"
          >
            {isGeneratingRequirements ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full inline-block mr-2"></div>
                Generating...
              </>
            ) : isSelectionMode && selectedMessages.size > 0 ? (
              `📋 Extract from ${selectedMessages.size} messages`
            ) : (
              '📋 Extract All Requirements'
            )}
          </button>

          {requirements && (
            <>
              <button
                onClick={downloadRequirements}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                💾 Download Requirements
              </button>

              {/* Show extracted requirements preview */}
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-2 text-sm">Extracted Requirements:</h4>
                <div className="text-xs text-gray-600 max-h-32 overflow-y-auto">
                  {requirements.substring(0, 200)}...
                </div>
              </div>
            </>
          )}

          <button
            onClick={endInterview}
            className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 font-medium text-sm"
          >
            End Interview
          </button>
        </div>

        {transcriptDownloaded && (
          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700 text-center">
            ✅ Transcript Downloaded
          </div>
        )}
      </div>

      {/* Chat Interface */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-white border-b border-gray-200 p-4">
          <h1 className="text-xl font-bold text-gray-900">Interview Session</h1>
          <p className="text-sm text-gray-600">
            Started at {currentSession.startTime.toLocaleTimeString()} • Session ID: {currentSession.id}
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {currentSession.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg cursor-pointer transition-all ${
                  msg.sender === 'student'
                    ? selectedMessages.has(msg.id) && isSelectionMode
                      ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : selectedMessages.has(msg.id) && isSelectionMode
                    ? 'bg-purple-100 border-2 border-purple-400 text-gray-900'
                    : 'bg-white border border-gray-200 text-gray-900 hover:border-gray-300'
                } ${isSelectionMode ? 'cursor-pointer' : ''}`}
                onClick={() => toggleMessageSelection(msg.id)}
              >
                {msg.sender === 'persona' && msg.personaName && (
                  <div className={`text-xs font-semibold mb-1 ${
                    selectedMessages.has(msg.id) && isSelectionMode
                      ? 'text-purple-700'
                      : 'text-indigo-600'
                  }`}>
                    {msg.personaName}
                  </div>
                )}
                <div className="text-sm">{msg.content}</div>
                <div className={`text-xs mt-1 ${
                  msg.sender === 'student'
                    ? selectedMessages.has(msg.id) && isSelectionMode
                      ? 'text-purple-200'
                      : 'text-indigo-200'
                    : 'text-gray-500'
                }`}>
                  {msg.timestamp.toLocaleTimeString()}
                  {selectedMessages.has(msg.id) && isSelectionMode && (
                    <span className="ml-2">✓ Selected</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Ask your question..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black"
              disabled={isSelectionMode}
            />
            <button
              onClick={sendMessage}
              disabled={!message.trim() || isSelectionMode}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
          {isSelectionMode && (
            <p className="text-xs text-purple-600 mt-2">
              Selection mode active - click messages above to select them for requirement extraction
            </p>
          )}
        </div>
      </div>
    </div>
  )
}