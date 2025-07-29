// File: app/components/Navigation.tsx
'use client'
import { useRouter } from 'next/navigation'

interface NavigationProps {
  showHome?: boolean
  showInstructorDashboard?: boolean
  showInterview?: boolean
  showPersonas?: boolean
  className?: string
}

export function Navigation({
  showHome = true,
  showInstructorDashboard = false,
  showInterview = false,
  showPersonas = false,
  className = ""
}: NavigationProps = {}) {
  const router = useRouter()

  return (
    <div className={`flex gap-3 ${className}`}>
      {showHome && (
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center gap-2"
        >
          🏠 Home
        </button>
      )}

      {showPersonas && (
        <button
          onClick={() => router.push('/personas')}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center gap-2"
        >
          👥 Personas
        </button>
      )}

      {showInstructorDashboard && (
        <button
          onClick={() => router.push('/instructor-dashboard')}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
        >
          📊 Instructor Dashboard
        </button>
      )}

      {showInterview && (
        <button
          onClick={() => window.open('/interview', '_blank')}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
        >
          💬 Start Interview
        </button>
      )}
    </div>
  )
}