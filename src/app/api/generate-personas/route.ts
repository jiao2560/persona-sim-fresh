import { NextResponse } from 'next/server'
import { CohereClient } from 'cohere-ai'

// Initialize Cohere client
const cohere = new CohereClient({
  token: process.env.CO_API_KEY!
})

// Helper function to search GitHub repositories
async function searchGitHubRepos(domain: string, stories: string, count: number = 5) {
  // Create focused search terms
  const domainTerm = domain.toLowerCase()
  // Extract key words from stories (remove common words)
  const storyWords = stories.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(' ')
    .filter(word => word.length > 3 && !['this', 'that', 'with', 'for', 'and', 'the', 'are', 'can', 'will', 'want', 'need', 'user', 'system'].includes(word))
    .slice(0, 3) // Take top 3 relevant words
    .join(' ')

  const searchQuery = `${domainTerm} ${storyWords}`.trim()

  // Try multiple search strategies
  const searchStrategies = [
    searchQuery,
    domainTerm,
    `${domainTerm} system`,
    `${domainTerm} app`,
  ]

  for (const query of searchStrategies) {
    if (!query.trim()) continue

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${count}`

    console.log('Trying GitHub search with query:', query)
    console.log('GitHub search URL:', url)

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'PersonaGenerator/1.0',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })

      console.log('GitHub API response status:', response.status)

      if (response.status === 403) {
        const errorData = await response.json()
        console.error('GitHub API rate limit or forbidden:', errorData)
        continue // Try next strategy
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('GitHub search failed:', response.status, errorText)
        continue // Try next strategy
      }

      const data = await response.json()
      console.log('GitHub search results:', data.total_count, 'repos found for query:', query)

      if (data.items && data.items.length > 0) {
        return data.items
      }
    } catch (error) {
      console.error('GitHub search error for query:', query, error)
      continue // Try next strategy
    }
  }

  console.log('All GitHub search strategies failed')
  return []
}

// Helper function to fetch README content
async function fetchReadmeContent(owner: string, repo: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/readme`

  console.log(`Fetching README for ${owner}/${repo}`)

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'PersonaGenerator/1.0'
      }
    })

    console.log(`README fetch status for ${owner}/${repo}:`, response.status)

    if (!response.ok) {
      console.log(`No README found for ${owner}/${repo}`)
      return null
    }

    const data = await response.json()
    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    console.log(`README length for ${owner}/${repo}:`, content.length, 'characters')
    return content
  } catch (error) {
    console.error(`Error fetching README for ${owner}/${repo}:`, error)
    return null
  }
}

export async function POST(req: Request) {
  try {
    // 1. Parse incoming request
    const { projectName, domain, stories, count } = await req.json()
    const effectiveDomain = domain?.trim() || 'General'

    // 2. Search for related GitHub repositories
    console.log('=== GITHUB SEARCH DEBUG ===')
    console.log('Domain:', effectiveDomain)
    console.log('Stories:', stories)
    console.log('Searching GitHub repositories...')
    const repos = await searchGitHubRepos(effectiveDomain, stories, 5)
    console.log('Final repositories found:', repos.length)

    // 3. Fetch README content from found repositories
    console.log('=== README FETCH DEBUG ===')
    console.log('Fetching README content...')
    const readmeContents: string[] = []
    const repoReferences: Array<{name: string, url: string, description: string}> = []

    for (const repo of repos.slice(0, 5)) {
      console.log(`Processing repo: ${repo.full_name}`)
      const readme = await fetchReadmeContent(repo.owner.login, repo.name)
      if (readme) {
        // Take first 1000 characters to avoid token limits
        readmeContents.push(readme.substring(0, 1000))
        console.log(`Added README content (${readme.length} chars) from ${repo.full_name}`)
      }

      repoReferences.push({
        name: repo.full_name,
        url: repo.html_url,
        description: repo.description || 'No description available'
      })
    }

    console.log('Total README contents collected:', readmeContents.length)
    console.log('Total repo references:', repoReferences.length)

    // 4. Generate project outline
    const outlinePrompt = `Based on the project details and related GitHub repositories, create a concise project outline (2-3 paragraphs) describing what this project is about:

Project: ${projectName}
Domain: ${effectiveDomain}
Context: ${stories}

Related Repository Examples:
${repoReferences.map(repo => `- ${repo.name}: ${repo.description}`).join('\n')}

Provide only the project outline, no additional text.`

    const outlineResponse = await cohere.chat({
      model: 'command-r-plus',
      message: outlinePrompt,
      maxTokens: 300,
      temperature: 0.7,
    })

    const projectOutline = outlineResponse.text?.trim() || 'This project focuses on delivering solutions in the specified domain with attention to user needs and stakeholder requirements.'

    // 5. Build enhanced persona generation prompt
    const systemPrompt = `You are an expert at creating realistic stakeholder personas for software projects based on real-world examples and industry patterns.

Generate exactly ${count} realistic personas as a JSON array. Each persona should be an object with these exact fields:
- name (string): Full name
- initials (string): First and last name initials
- role (string): Their job title or role
- goal (string): What they want to achieve
- concerns (string): What worries them or challenges they face
- personality (string): Brief personality description

Base your personas on real stakeholder patterns from similar projects. Make them specific to the domain and realistic.

Return ONLY the JSON array, no other text.`

    const contextualPrompt = `Project: ${projectName}
Domain: ${effectiveDomain}
Context & Requirements: ${stories}

Real-world context from similar projects:
${readmeContents.length > 0 ? readmeContents.join('\n\n---\n\n').substring(0, 2000) : 'No additional context available'}

Generate personas that would realistically be involved in a project like this, based on the patterns you see in similar real-world projects.`

    // 6. Call Cohere API for persona generation
    const response = await cohere.chat({
      model: 'command-r-plus',
      message: `${systemPrompt}\n\n${contextualPrompt}`,
      maxTokens: 1000,
      temperature: 0.8,
    })

    // 7. Extract and clean the response text
    let rawText = response.text?.trim() || ''
    rawText = rawText.replace(/```json\s*|\s*```/g, '').trim()

    // 8. Parse the JSON response
    let personas = []
    try {
      personas = JSON.parse(rawText)

      if (!Array.isArray(personas)) {
        throw new Error('Response is not an array')
      }

      personas = personas.map(persona => ({
        name: persona.name || 'Unknown',
        initials: persona.initials || 'UK',
        role: persona.role || 'Stakeholder',
        goal: persona.goal || 'To be defined',
        concerns: persona.concerns || 'None specified',
        personality: persona.personality || 'Professional'
      }))

    } catch (parseError) {
      console.error('Failed to parse personas JSON:', parseError)
      console.error('Raw response:', rawText)

      // Fallback: create default personas
      personas = Array.from({ length: count }, (_, i) => ({
        name: `Person ${i + 1}`,
        initials: `P${i + 1}`,
        role: `Role ${i + 1}`,
        goal: 'To be defined',
        concerns: 'None specified',
        personality: 'Professional'
      }))
    }

    // 9. Return comprehensive response
    return NextResponse.json({
      personas: personas.slice(0, count),
      projectOutline,
      references: repoReferences,
      metadata: {
        searchQuery: `${effectiveDomain} ${stories}`,
        reposFound: repos.length,
        readmesProcessed: readmeContents.length
      }
    })

  } catch (error) {
    console.error('API error:', error)

    return NextResponse.json(
      {
        error: 'Failed to generate personas',
        personas: [],
        projectOutline: 'Error generating project outline',
        references: []
      },
      { status: 500 }
    )
  }
}