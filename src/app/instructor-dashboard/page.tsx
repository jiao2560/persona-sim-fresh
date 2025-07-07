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

interface CoverageReport {
  overallCoverageRate: number
  strengths: string[]
  improvements: string[]
  detailedAnalysis: string
  analyzedAt: Date
}

interface StudentSession {
  sessionId: string
  studentName: string
  startTime: Date
  endTime?: Date
  duration: number
  messageCount: number
  personasInterviewed: string[]
  lastActivity: Date
  status: 'active' | 'completed' | 'abandoned'
  requirementsExtracted: boolean
  transcriptDownloaded: boolean
  requirementCoverageRate?: number
  coverageReport?: CoverageReport
}

interface ClassOverview {
  totalStudents: number
  activeStudents: number
  completedSessions: number
  avgSessionDuration: number
  avgMessagesPerSession: number
  commonTopics: { topic: string; count: number }[]
  personaEngagement: {
    personaName: string
    messageCount: number
    engagementRate: number
    avgResponseConfidence: number
    collaborativeDiscussions: number
  }[]
  overallProgress: number
}

interface DashboardData {
  projectName: string
  domain: string
  personas: Persona[]
  studentSessions: StudentSession[]
  classOverview: ClassOverview
  recentActivity: {
    timestamp: Date
    studentName: string
    action: string
    details: string
  }[]
}

export default function InstructorDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'personas' | 'activity'>('overview')
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'duration' | 'messages'>('name')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'abandoned'>('all')
  const [selectedReport, setSelectedReport] = useState<CoverageReport | null>(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [analyzingSession, setAnalyzingSession] = useState<string | null>(null)
  const [sessionCoverages, setSessionCoverages] = useState<Record<string, number>>({})
  const router = useRouter()

  useEffect(() => {
    loadDashboardData()
    // Set up polling for real-time updates
    const interval = setInterval(loadDashboardData, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const loadDashboardData = async () => {
    const projectData = sessionStorage.getItem('originalRequest')
    const personasData = sessionStorage.getItem('personas')

    if (!projectData || !personasData) {
      router.push('/')
      return
    }

    try {
      const project = JSON.parse(projectData)
      const { personas } = JSON.parse(personasData)

      const response = await fetch('/api/instructor-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: project.projectName,
          domain: project.domain,
          personas
        })
      })

      if (!response.ok) throw new Error('Failed to load dashboard')

      const data = await response.json()
      setDashboardData(data)
    } catch (error) {
      console.error('Error loading dashboard:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const analyzeCoverage = async (session: StudentSession) => {
    setAnalyzingSession(session.sessionId)

    try {
      const response = await fetch(`/api/instructor-dashboard?sessionId=${session.sessionId}&action=analyze-coverage`)

      if (!response.ok) {
        throw new Error('Failed to analyze coverage')
      }

      const data = await response.json()

      if (data.success) {
        // Update local state with coverage
        setSessionCoverages(prev => ({
          ...prev,
          [session.sessionId]: data.coverage
        }))

        // Show the report
        if (data.report) {
          setSelectedReport(data.report)
          setShowReportModal(true)
        }
      }
    } catch (error) {
      console.error('Error analyzing coverage:', error)
      alert('Failed to analyze coverage. Please try again.')
    } finally {
      setAnalyzingSession(null)
    }
  }

  const viewCoverageReport = async (session: StudentSession) => {
    // First check if we have a cached report
    try {
      const response = await fetch(`/api/instructor-dashboard?sessionId=${session.sessionId}&action=get-report`)

      if (response.ok) {
        const data = await response.json()
        if (data.report) {
          setSelectedReport(data.report)
          setShowReportModal(true)
          return
        }
      }
    } catch (error) {
      console.error('Error fetching report:', error)
    }

    // If no cached report, analyze first
    await analyzeCoverage(session)
  }

  const getFilteredSessions = () => {
    if (!dashboardData) return []

    let filtered = dashboardData.studentSessions
    if (filterStatus !== 'all') {
      filtered = filtered.filter(s => s.status === filterStatus)
    }

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.studentName.localeCompare(b.studentName)
        case 'status':
          return a.status.localeCompare(b.status)
        case 'duration':
          return (b.duration || 0) - (a.duration || 0)
        case 'messages':
          return b.messageCount - a.messageCount
        default:
          return 0
      }
    })
  }

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - new Date(date).getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return `${minutes}m ago`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard data...</p>
        </div>
      </div>
    )
  }

  if (!dashboardData) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Instructor Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">
                {dashboardData.projectName} • {dashboardData.domain} Domain
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/personas')}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                ← Back to Personas
              </button>
              <button
                onClick={loadDashboardData}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {(['overview', 'students', 'personas', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm capitalize ${
                  activeTab === tab
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Cards - Removed Avg Coverage */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-600">Total Students</p>
                    <p className="text-2xl font-bold text-gray-900">{dashboardData.classOverview.totalStudents}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-600">Active Now</p>
                    <p className="text-2xl font-bold text-green-600">{dashboardData.classOverview.activeStudents}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 bg-green-600 rounded-full animate-pulse"></div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-600">Completed</p>
                    <p className="text-2xl font-bold text-gray-900">{dashboardData.classOverview.completedSessions}</p>
                  </div>
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-600">Avg Duration</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {Math.round(dashboardData.classOverview.avgSessionDuration)}m
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Overall Class Progress</h3>
              <div className="relative">
                <div className="w-full bg-gray-200 rounded-full h-8">
                  <div
                    className="bg-indigo-600 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                    style={{ width: `${dashboardData.classOverview.overallProgress}%` }}
                  >
                    {Math.round(dashboardData.classOverview.overallProgress)}%
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                {dashboardData.classOverview.completedSessions} of {dashboardData.classOverview.totalStudents} students completed their interviews
              </p>
            </div>
          </div>
        )}

        {/* Students Tab */}
        {activeTab === 'students' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">Student Sessions</h3>
                <div className="flex gap-4">
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded text-sm"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="abandoned">Abandoned</option>
                  </select>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="px-3 py-2 border border-gray-300 rounded text-sm"
                  >
                    <option value="name">Sort by Name</option>
                    <option value="status">Sort by Status</option>
                    <option value="duration">Sort by Duration</option>
                    <option value="messages">Sort by Messages</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Coverage</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Messages</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Personas</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getFilteredSessions().map((session) => (
                    <tr key={session.sessionId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{session.studentName}</div>
                          <div className="text-xs text-gray-500">Last active {formatTimeAgo(session.lastActivity)}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          session.status === 'active' ? 'bg-green-100 text-green-800' :
                          session.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const coverage = sessionCoverages[session.sessionId] || session.requirementCoverageRate

                          if (coverage !== undefined) {
                            return (
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full ${
                                      coverage >= 80 ? 'bg-green-500' :
                                      coverage >= 60 ? 'bg-yellow-500' :
                                      coverage >= 40 ? 'bg-orange-500' :
                                      'bg-red-500'
                                    }`}
                                    style={{ width: `${coverage}%` }}
                                  />
                                </div>
                                <span className={`text-sm font-medium ${
                                  coverage >= 80 ? 'text-green-700' :
                                  coverage >= 60 ? 'text-yellow-700' :
                                  coverage >= 40 ? 'text-orange-700' :
                                  'text-red-700'
                                }`}>
                                  {coverage.toFixed(0)}%
                                </span>
                              </div>
                            )
                          } else if (session.status === 'completed' && session.messageCount > 5) {
                            return (
                              <button
                                onClick={() => analyzeCoverage(session)}
                                disabled={analyzingSession === session.sessionId}
                                className="text-sm text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                              >
                                {analyzingSession === session.sessionId ? (
                                  <span className="flex items-center gap-1">
                                    <div className="animate-spin h-3 w-3 border-2 border-indigo-600 border-t-transparent rounded-full"></div>
                                    Analyzing...
                                  </span>
                                ) : (
                                  'Analyze'
                                )}
                              </button>
                            )
                          } else {
                            return <span className="text-sm text-gray-400">-</span>
                          }
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {session.duration ? formatDuration(session.duration) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {session.messageCount}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="flex -space-x-2">
                          {session.personasInterviewed.slice(0, 3).map((persona, i) => (
                            <div
                              key={i}
                              className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold border-2 border-white"
                              title={persona}
                            >
                              {persona.split(' ').map(n => n[0]).join('')}
                            </div>
                          ))}
                          {session.personasInterviewed.length > 3 && (
                            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs font-bold border-2 border-white">
                              +{session.personasInterviewed.length - 3}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2 items-center">
                          {session.requirementsExtracted && (
                            <span className="text-green-600" title="Requirements extracted">📋</span>
                          )}
                          {session.transcriptDownloaded && (
                            <span className="text-blue-600" title="Transcript downloaded">💾</span>
                          )}
                          {(sessionCoverages[session.sessionId] !== undefined ||
                            (session.status === 'completed' && session.messageCount > 5)) && (
                            <button
                              onClick={() => viewCoverageReport(session)}
                              className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700"
                            >
                              View Report
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Personas Tab */}
        {activeTab === 'personas' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dashboardData.classOverview.personaEngagement.map((engagement, index) => {
              const persona = dashboardData.personas.find(p => p.name === engagement.personaName)
              if (!persona) return null

              return (
                <div key={index} className="bg-white rounded-lg shadow p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold">
                      {persona.initials}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{persona.name}</h3>
                      <p className="text-sm text-gray-600">{persona.role}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Engagement Rate</span>
                      <span className="text-sm font-medium text-gray-900">{Math.round(engagement.engagementRate)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-indigo-600 h-2 rounded-full"
                        style={{ width: `${engagement.engagementRate}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div>
                        <p className="text-xs text-gray-600">Messages</p>
                        <p className="text-lg font-medium text-gray-900">{engagement.messageCount}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Selected by</p>
                        <p className="text-lg font-medium text-gray-900">
                          {Math.round(engagement.engagementRate)}%
                        </p>
                      </div>
                    </div>

                    {engagement.collaborativeDiscussions > 0 && (
                      <div className="pt-2 border-t border-gray-200">
                        <p className="text-sm text-gray-600">
                          🤝 {engagement.collaborativeDiscussions} collaborative discussions
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Recent Activity</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {dashboardData.recentActivity.map((activity, index) => (
                <div key={index} className="p-6 hover:bg-gray-50">
                  <div className="flex items-start gap-4">
                    <div className="text-2xl">{activity.details.split(' ')[0]}</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {activity.studentName} {activity.action}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {activity.details.split(' ').slice(1).join(' ')}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatTimeAgo(activity.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Coverage Report Modal */}
      {showReportModal && selectedReport && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mb-4 flex justify-between items-start">
              <h3 className="text-lg font-bold text-gray-900">Coverage Analysis Report</h3>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <div className="mb-4">
                <h4 className="font-semibold text-gray-800 mb-2">Performance Summary</h4>
                <p className="text-2xl font-bold text-indigo-600">{selectedReport.overallCoverageRate.toFixed(1)}% Coverage</p>
                <p className="text-sm text-gray-600">Analyzed on {new Date(selectedReport.analyzedAt).toLocaleDateString()}</p>
              </div>

              <div className="mb-4">
                <h4 className="font-semibold text-gray-800 mb-2">Strengths</h4>
                <ul className="list-disc list-inside space-y-1">
                  {selectedReport.strengths.map((strength, i) => (
                    <li key={i} className="text-sm text-gray-700">{strength}</li>
                  ))}
                </ul>
              </div>

              <div className="mb-4">
                <h4 className="font-semibold text-gray-800 mb-2">Areas for Improvement</h4>
                <ul className="list-disc list-inside space-y-1">
                  {selectedReport.improvements.map((improvement, i) => (
                    <li key={i} className="text-sm text-gray-700">{improvement}</li>
                  ))}
                </ul>
              </div>

              {selectedReport.detailedAnalysis && (
                <div className="mb-4">
                  <h4 className="font-semibold text-gray-800 mb-2">Detailed Analysis</h4>
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-4 rounded">
                      {selectedReport.detailedAnalysis}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}