// File: src/app/page.tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function InstructorPage() {
  const [projectName, setProjectName] = useState('')
  const [domain, setDomain] = useState<'Healthcare'|'E-commerce'|'Education'|'Finance'|'Custom'>('Healthcare')
  const [customDomain, setCustomDomain] = useState('')
  const [stories, setStories] = useState('')
  const [personaCount, setPersonaCount] = useState(3)
  const [isGenerating, setIsGenerating] = useState(false)
  const router = useRouter()

  const handleGenerate = async () => {
    const effectiveDomain = domain === 'Custom' ? customDomain.trim() : domain
    const payload = {
      projectName: projectName.trim(),
      domain: effectiveDomain,
      stories: stories.trim(),
      count: personaCount,
    }

    // Validation
    if (!payload.projectName) {
      alert('Please enter a project name')
      return
    }

    if (!payload.domain) {
      alert('Please select or enter a domain')
      return
    }

    if (!payload.stories) {
      alert('Please provide project description and context')
      return
    }

    setIsGenerating(true)

    try {
      const res = await fetch('/api/generate-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error('Network response was not ok')
      }

      const responseData = await res.json()

      // Store both the personas data and the original request for regeneration
      sessionStorage.setItem('personas', JSON.stringify(responseData))
      sessionStorage.setItem('originalRequest', JSON.stringify(payload))

      router.push('/personas')
    } catch (error) {
      console.error('Generation error:', error)
      alert('Error generating personas. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Instructor Dashboard</h1>
        <p className="text-gray-400">Generate realistic personas based on real GitHub projects in your domain</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block mb-1 font-medium text-sm">Project Name</label>
          <input
            type="text"
            placeholder="e.g., Patient Management System"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block mb-1 font-medium text-sm">Domain</label>
          <select
            value={domain}
            onChange={e => setDomain(e.target.value as any)}
            className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-black text-white"
            style={{
              backgroundColor: '#000000',
              color: '#ffffff'
            }}
          >
            {['Healthcare','E-commerce','Education','Finance','Custom'].map(d => (
              <option key={d} value={d} className="bg-black text-white">{d}</option>
            ))}
          </select>
        </div>

        {domain === 'Custom' && (
          <div>
            <label className="block mb-1 font-medium text-sm">Custom Domain</label>
            <input
              type="text"
              placeholder="e.g., Manufacturing, Real Estate, Gaming"
              value={customDomain}
              onChange={e => setCustomDomain(e.target.value)}
              className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        )}

        <div>
          <label className="block mb-1 font-medium text-sm">
            Project & Persona Description
          </label>
          <textarea
            placeholder={`Describe your project and the types of people who will use it. Examples:

"This is a healthcare record system for managing patient data. Key users include nurses who need quick access to patient records, doctors who want comprehensive medical histories, and administrators who manage user permissions and data compliance."

"An e-commerce platform for small businesses. Target users include shop owners who want easy inventory management, customers who value simple checkout processes, and support staff who handle customer inquiries."`}
            value={stories}
            onChange={e => setStories(e.target.value)}
            className="w-full px-4 py-2 border rounded h-48 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <p className="text-sm text-gray-400 mt-1">
            💡 <strong>Pro tip:</strong> The system will analyze similar GitHub projects to create more realistic personas. Be specific about user types and their needs.
          </p>
        </div>

        <div>
          <label className="block mb-1 font-medium text-sm">Number of Personas</label>
          <select
            value={personaCount}
            onChange={e => setPersonaCount(Number(e.target.value))}
            className="w-full px-4 py-2 border rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-black text-white"
            style={{
              backgroundColor: '#000000',
              color: '#ffffff'
            }}
          >
            {[3,4,5].map(n => (
              <option key={n} value={n} className="bg-black text-white">{n} personas</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full bg-indigo-600 text-white py-3 rounded hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
        >
          {isGenerating ? (
            <>
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
              Analyzing GitHub projects & generating personas...
            </>
          ) : (
            <>
              🚀 Generate Personas
            </>
          )}
        </button>

        {isGenerating && (
          <div className="text-center text-sm text-gray-500">
            <p>🔍 Searching for similar projects on GitHub...</p>
            <p>📖 Analyzing README files for context...</p>
            <p>👥 Creating realistic personas...</p>
          </div>
        )}
      </div>
    </div>
  )
}