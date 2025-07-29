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

interface Reference {
  name: string
  url: string
  description: string
}

interface PersonaData {
  personas: Persona[]
  projectOutline?: string
  requirements?: string[]
  references?: Reference[]
  metadata?: {
    searchQuery: string
    reposFound: number
    readmesProcessed: number
  }
}

interface DeletedRequirement {
  req: string
  index: number
  timestamp: number
}

interface ArchivedSession {
  id: string
  personas: Persona[]
  timestamp: Date
  projectName: string
  messageCount: number
}

export default function PersonasPage() {
  const [data, setData] = useState<PersonaData>({ personas: [] })
  const [originalRequest, setOriginalRequest] = useState<any>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isEditingRequirements, setIsEditingRequirements] = useState(false)
  const [editableRequirements, setEditableRequirements] = useState<string[]>([])
  const [newRequirement, setNewRequirement] = useState('')
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)
  const [customRequirements, setCustomRequirements] = useState<string[]>([])
  const [customRequirementInput, setCustomRequirementInput] = useState('')

  // New state for delete confirmation and undo
  const [deleteConfirm, setDeleteConfirm] = useState<{show: boolean, index: number}>({show: false, index: -1})
  const [deletedRequirements, setDeletedRequirements] = useState<DeletedRequirement[]>([])
  const [showUndoNotification, setShowUndoNotification] = useState(false)

  // New state for archived sessions
  const [showArchivesModal, setShowArchivesModal] = useState(false)
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSession[]>([])

  const router = useRouter()

  useEffect(() => {
    // Load personas and related data
    const raw = sessionStorage.getItem('personas')
    const requestRaw = sessionStorage.getItem('originalRequest')

    if (!raw) return router.push('/') // no data → back to home

    try {
      const parsedData = JSON.parse(raw)
      // Handle both old format (just personas array) and new format (object with personas + extras)
      if (Array.isArray(parsedData)) {
        setData({ personas: parsedData })
      } else {
        setData(parsedData)
        // Initialize editable requirements
        if (parsedData.requirements) {
          setEditableRequirements(parsedData.requirements)
        }
      }

      if (requestRaw) {
        setOriginalRequest(JSON.parse(requestRaw))
      }

      // Load archived sessions
      const archives = sessionStorage.getItem('archived_sessions')
      if (archives) {
        try {
          const parsedArchives = JSON.parse(archives)
          setArchivedSessions(parsedArchives)
        } catch (e) {
          console.error('Error parsing archived sessions:', e)
        }
      }
    } catch (error) {
      console.error('Error parsing session data:', error)
      router.push('/')
    }
  }, [router])

  const handleStartEdit = () => {
    setIsEditingRequirements(true)
    setEditableRequirements(data.requirements || [])
    // Clear deleted requirements when starting a new edit session
    setDeletedRequirements([])
  }

  const handleSaveRequirements = () => {
    const updatedData = {
      ...data,
      requirements: editableRequirements
    }
    setData(updatedData)
    sessionStorage.setItem('personas', JSON.stringify(updatedData))
    setIsEditingRequirements(false)
    // Clear deleted requirements after saving
    setDeletedRequirements([])
  }

  const handleCancelEdit = () => {
    setIsEditingRequirements(false)
    setEditableRequirements(data.requirements || [])
    setNewRequirement('')
    // Clear deleted requirements when canceling
    setDeletedRequirements([])
  }

  const handleAddRequirement = () => {
    if (newRequirement.trim()) {
      setEditableRequirements([...editableRequirements, newRequirement.trim()])
      setNewRequirement('')
    }
  }

  const handleDeleteRequirement = (index: number) => {
    setDeleteConfirm({show: true, index})
  }

  const handleConfirmDelete = () => {
    const index = deleteConfirm.index
    const deletedReq = editableRequirements[index]

    // Store the deleted requirement with its original index
    setDeletedRequirements([...deletedRequirements, {
      req: deletedReq,
      index: index,
      timestamp: Date.now()
    }])

    // Remove the requirement
    setEditableRequirements(editableRequirements.filter((_, i) => i !== index))

    // Close the confirmation dialog
    setDeleteConfirm({show: false, index: -1})

    // Show undo notification
    setShowUndoNotification(true)
    setTimeout(() => setShowUndoNotification(false), 5000)
  }

  const handleUndoDelete = () => {
    if (deletedRequirements.length === 0) return

    // Get the most recently deleted requirement
    const lastDeleted = deletedRequirements[deletedRequirements.length - 1]

    // Create a new array with the requirement inserted back at its original position
    const newRequirements = [...editableRequirements]
    newRequirements.splice(lastDeleted.index, 0, lastDeleted.req)

    setEditableRequirements(newRequirements)

    // Remove the last deleted requirement from the undo stack
    setDeletedRequirements(deletedRequirements.slice(0, -1))
  }

  const handleUpdateRequirement = (index: number, value: string) => {
    const updated = [...editableRequirements]
    updated[index] = value
    setEditableRequirements(updated)
  }

  const handleAddCustomRequirement = () => {
    if (customRequirementInput.trim()) {
      setCustomRequirements([...customRequirements, customRequirementInput.trim()])
      setCustomRequirementInput('')
    }
  }

  const handleDeleteCustomRequirement = (index: number) => {
    setCustomRequirements(customRequirements.filter((_, i) => i !== index))
  }

  const archiveCurrentSession = () => {
    // Archive the current personas configuration regardless of interview status
    const archivedSession: ArchivedSession = {
      id: `archive-${Date.now()}`,
      personas: data.personas,
      timestamp: new Date(),
      projectName: originalRequest?.projectName || 'Unknown Project',
      messageCount: 0 // Will be updated if we find interview data
    }

    // Check multiple possible storage locations for interview data
    const possibleKeys = ['currentSession', 'interview_session', 'interviewMessages']
    let foundSession = false

    for (const key of possibleKeys) {
      const sessionData = sessionStorage.getItem(key)
      if (sessionData) {
        try {
          const parsed = JSON.parse(sessionData)
          if (parsed.messages && Array.isArray(parsed.messages)) {
            archivedSession.messageCount = parsed.messages.length
            // Store the full session data
            sessionStorage.setItem(`archived_session_${archivedSession.id}`, JSON.stringify({
              ...archivedSession,
              messages: parsed.messages,
              selectedPersonas: parsed.selectedPersonas || parsed.engagedPersonas || []
            }))
            foundSession = true
            break
          }
        } catch (error) {
          console.error(`Error parsing ${key}:`, error)
        }
      }
    }

    // If no interview data found, still archive the personas configuration
    if (!foundSession) {
      sessionStorage.setItem(`archived_session_${archivedSession.id}`, JSON.stringify({
        ...archivedSession,
        messages: [],
        selectedPersonas: []
      }))
    }

    // Update the archives list
    const archives = [...archivedSessions, archivedSession]
    setArchivedSessions(archives)
    sessionStorage.setItem('archived_sessions', JSON.stringify(archives))

    // Log for debugging
    console.log('Archived session:', archivedSession)
    console.log('Total archives:', archives.length)

    return true
  }

  const handleRegenerate = async () => {
    if (!originalRequest) {
      alert('Cannot regenerate - original request data not found')
      return
    }

    // Archive current session before regenerating
    const wasArchived = archiveCurrentSession()
    if (wasArchived) {
      // Show different message based on whether interview data was found
      const latestArchive = archivedSessions[archivedSessions.length - 1]
      if (latestArchive && latestArchive.messageCount > 0) {
        alert(`Interview session with ${latestArchive.messageCount} messages has been archived. You can access it from "View Previous Sessions".`)
      } else {
        alert('Current personas configuration has been archived. You can access it from "View Previous Sessions".')
      }
    }

    setIsRegenerating(true)
    setShowRegenerateModal(false)

    try {
      // Include custom requirements in the regeneration request
      const regenerateRequest = {
        ...originalRequest,
        customRequirements: customRequirements.length > 0 ? customRequirements : undefined
      }

      const res = await fetch('/api/generate-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regenerateRequest),
      })

      if (!res.ok) {
        throw new Error('Failed to regenerate personas')
      }

      const newData = await res.json()
      setData(newData)
      setEditableRequirements(newData.requirements || [])

      // Update session storage
      sessionStorage.setItem('personas', JSON.stringify(newData))

      // Clear custom requirements after successful regeneration
      setCustomRequirements([])

    } catch (error) {
      console.error('Regeneration error:', error)
      alert('Error regenerating personas. Please try again.')
    } finally {
      setIsRegenerating(false)
    }
  }

  const viewArchivedSession = (sessionId: string) => {
    const archivedData = sessionStorage.getItem(`archived_session_${sessionId}`)
    if (archivedData) {
      try {
        const session = JSON.parse(archivedData)
        // Open interview page with archived data
        sessionStorage.setItem('viewingArchived', JSON.stringify(session))
        window.open('/interview?archived=true', '_blank')
      } catch (error) {
        console.error('Error loading archived session:', error)
        alert('Failed to load archived session')
      }
    }
  }

  const deleteArchivedSession = (sessionId: string) => {
    if (confirm('Are you sure you want to delete this archived session?')) {
      // Remove from storage
      sessionStorage.removeItem(`archived_session_${sessionId}`)

      // Update archives list
      const updatedArchives = archivedSessions.filter(s => s.id !== sessionId)
      setArchivedSessions(updatedArchives)
      sessionStorage.setItem('archived_sessions', JSON.stringify(updatedArchives))
    }
  }

  const { personas, projectOutline, requirements, references, metadata } = data

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <h1 className="text-3xl font-bold text-black">Generated Personas</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setShowArchivesModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
          >
            📚 View Previous Sessions ({archivedSessions.length})
          </button>
          <button
            onClick={() => router.push('/instructor-dashboard')}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
          >
            📊 View Student Progress
          </button>
          <button
            onClick={() => window.open('/interview', '_blank')}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
          >
            💬 Start Interview
          </button>
          <button
            onClick={() => setShowRegenerateModal(true)}
            disabled={isRegenerating || !originalRequest}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isRegenerating ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                Regenerating...
              </>
            ) : (
              <>
                🔄 Regenerate Personas
              </>
            )}
          </button>
          {/* Use Navigation component */}
          <Navigation showHome={true} />
        </div>
      </div>

      {/* Project Outline Section */}
      {projectOutline && (
        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h2 className="text-xl font-semibold mb-3 text-blue-800">Project Outline</h2>
          <div className="text-gray-700 whitespace-pre-line">
            {projectOutline}
          </div>
          {metadata && (
            <div className="mt-3 text-sm text-blue-600">
              Based on analysis of {metadata.reposFound} repositories, {metadata.readmesProcessed} READMEs processed
            </div>
          )}
        </div>
      )}

      {/* Requirements Section */}
      <div className="mb-8 p-6 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-green-800">Project Requirements</h2>
          {!isEditingRequirements ? (
            <button
              onClick={handleStartEdit}
              className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
            >
              ✏️ Edit Requirements
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleSaveRequirements}
                className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
              >
                💾 Save
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {!isEditingRequirements ? (
          <ul className="space-y-2">
            {(requirements || editableRequirements).length > 0 ? (
              (requirements || editableRequirements).map((req, i) => (
                <li key={i} className="flex items-start">
                  <span className="text-green-600 mr-2">•</span>
                  <span className="text-gray-700">{req}</span>
                </li>
              ))
            ) : (
              <li className="text-gray-500 italic">No requirements generated yet. Click Edit to add some.</li>
            )}
          </ul>
        ) : (
          <div className="space-y-3">
            {editableRequirements.map((req, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-green-600">•</span>
                <input
                  type="text"
                  value={req}
                  onChange={(e) => handleUpdateRequirement(i, e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-gray-700"
                />
                <button
                  onClick={() => handleDeleteRequirement(i)}
                  className="px-2 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-4">
              <span className="text-green-600">•</span>
              <input
                type="text"
                value={newRequirement}
                onChange={(e) => setNewRequirement(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddRequirement()}
                placeholder="Add new requirement..."
                className="flex-1 px-2 py-1 border border-gray-300 rounded text-gray-700"
              />
              <button
                onClick={handleAddRequirement}
                className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
              >
                Add
              </button>
            </div>

            {/* Undo delete option */}
            {deletedRequirements.length > 0 && (
              <div className="flex items-center justify-end mt-3">
                <button
                  onClick={handleUndoDelete}
                  className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
                >
                  ↩️ Undo last delete ({deletedRequirements.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Personas Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {personas.map((p, i) => (
          <div key={i} className="border rounded-lg p-4 shadow-sm bg-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold">
                {p.initials}
              </div>
              <div>
                <h2 className="font-semibold text-black">{p.name}</h2>
                <p className="text-sm text-gray-600">{p.role}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-black"><strong className="text-green-700">Goal:</strong> {p.goal}</p>
              <p className="text-black"><strong className="text-red-700">Concerns:</strong> {p.concerns}</p>
              <p className="text-black"><strong className="text-blue-700">Personality:</strong> {p.personality}</p>
            </div>
          </div>
        ))}
      </div>

      {/* References Section */}
      {references && references.length > 0 && (
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">GitHub Project References</h2>
          <div className="text-sm text-gray-600 mb-4">
            These personas were informed by analyzing similar projects on GitHub:
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {references.map((ref, i) => (
              <div key={i} className="border border-gray-300 rounded p-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h3 className="font-medium text-blue-600 text-sm">
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {ref.name}
                      </a>
                    </h3>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {ref.description}
                    </p>
                  </div>
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-gray-600 text-xs"
                  >
                    ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Confirm Delete</h3>
            <p className="text-gray-700 mb-6">
              Are you sure you want to delete this requirement? You can undo this action later.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm({show: false, index: -1})}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Notification Toast */}
      {showUndoNotification && (
        <div className="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
          <span>Requirement deleted</span>
          <button
            onClick={handleUndoDelete}
            className="text-blue-300 hover:text-blue-100 underline"
          >
            Undo
          </button>
        </div>
      )}

      {/* Archived Sessions Modal */}
      {showArchivesModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">Previous Interview Sessions</h3>
              <button
                onClick={() => setShowArchivesModal(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {archivedSessions.length === 0 ? (
              <p className="text-gray-600 text-center py-8">
                No archived sessions yet. Sessions are automatically archived when you regenerate personas.
              </p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {archivedSessions.map((session) => (
                  <div key={session.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900">{session.projectName}</h4>
                        <p className="text-sm text-gray-600 mt-1">
                          Archived on {new Date(session.timestamp).toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {session.messageCount > 0
                            ? `${session.messageCount} messages • ${session.personas.length} personas`
                            : `${session.personas.length} personas (no interview data)`
                          }
                        </p>
                        <div className="flex gap-2 mt-2">
                          {session.personas.slice(0, 3).map((persona, i) => (
                            <span key={i} className="text-xs bg-gray-100 px-2 py-1 rounded">
                              {persona.name}
                            </span>
                          ))}
                          {session.personas.length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{session.personas.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => viewArchivedSession(session.id)}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        >
                          View
                        </button>
                        <button
                          onClick={() => deleteArchivedSession(session.id)}
                          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowArchivesModal(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Modal */}
      {showRegenerateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Regenerate Personas with Custom Requirements</h3>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-800">
                ⚠️ <strong>Warning:</strong> Regenerating personas will archive any active interview session.
                You can access archived sessions later from "View Previous Sessions".
              </p>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Optionally add custom requirements that should be included when regenerating personas:
            </p>

            <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
              {customRequirements.map((req, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-green-600">•</span>
                  <span className="flex-1 text-gray-700">{req}</span>
                  <button
                    onClick={() => handleDeleteCustomRequirement(i)}
                    className="px-2 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-6">
              <input
                type="text"
                value={customRequirementInput}
                onChange={(e) => setCustomRequirementInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddCustomRequirement()}
                placeholder="Add custom requirement..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-black"
              />
              <button
                onClick={handleAddCustomRequirement}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Add
              </button>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRegenerateModal(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerate}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Regenerate with {customRequirements.length} Custom Requirements
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}