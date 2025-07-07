'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  references?: Reference[]
  metadata?: {
    searchQuery: string
    reposFound: number
    readmesProcessed: number
  }
}

export default function PersonasPage() {
  const [data, setData] = useState<PersonaData>({ personas: [] })
  const [originalRequest, setOriginalRequest] = useState<any>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Load personas and related data
    const raw = sessionStorage.getItem('personas')
    const requestRaw = sessionStorage.getItem('originalRequest')

    if (!raw) return router.push('/') // no data → back to dashboard

    try {
      const parsedData = JSON.parse(raw)
      // Handle both old format (just personas array) and new format (object with personas + extras)
      if (Array.isArray(parsedData)) {
        setData({ personas: parsedData })
      } else {
        setData(parsedData)
      }

      if (requestRaw) {
        setOriginalRequest(JSON.parse(requestRaw))
      }
    } catch (error) {
      console.error('Error parsing session data:', error)
      router.push('/')
    }
  }, [router])

  const handleRegenerate = async () => {
    if (!originalRequest) {
      alert('Cannot regenerate - original request data not found')
      return
    }

    setIsRegenerating(true)

    try {
      const res = await fetch('/api/generate-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(originalRequest),
      })

      if (!res.ok) {
        throw new Error('Failed to regenerate personas')
      }

      const newData = await res.json()
      setData(newData)

      // Update session storage
      sessionStorage.setItem('personas', JSON.stringify(newData))

    } catch (error) {
      console.error('Regeneration error:', error)
      alert('Error regenerating personas. Please try again.')
    } finally {
      setIsRegenerating(false)
    }
  }

  const { personas, projectOutline, references, metadata } = data

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <h1 className="text-3xl font-bold text-black">Generated Personas</h1>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/instructor-dashboard')}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
          >
            📊 View Student Progress
          </button>
          <button
            onClick={() => router.push('/interview')}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
          >
            💬 Start Interview
          </button>
          <button
            onClick={handleRegenerate}
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
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            ← Back to Dashboard
          </button>
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
    </div>
  )
}