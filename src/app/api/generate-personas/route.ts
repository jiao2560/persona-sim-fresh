import { NextResponse } from 'next/server'
import { CohereClient } from 'cohere-ai'

// Initialize Cohere client
const cohere = new CohereClient({
  token: process.env.CO_API_KEY!
})

// Helper function to extract meaningful keywords from project description
function extractProjectKeywords(projectName: string, stories: string): string[] {
  // Combine project name and stories for analysis
  const fullText = `${projectName} ${stories}`.toLowerCase();

  // Common stop words to exclude
  const stopWords = new Set([
    'this', 'that', 'with', 'for', 'and', 'the', 'are', 'can', 'will',
    'want', 'need', 'user', 'system', 'project', 'using', 'should', 'must',
    'have', 'make', 'help', 'allow', 'enable', 'provide', 'includes'
  ]);

  // Extract all words
  const words = fullText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  // Prioritize compound words (like "web-based", "repository")
  const compoundWords = fullText.match(/\w+[-]\w+/g) || [];

  // Prioritize capitalized words from project name (likely important terms)
  const capitalizedWords = projectName
    .split(/\s+/)
    .filter(word => word[0] === word[0].toUpperCase() && word.length > 2)
    .map(word => word.toLowerCase());

  // Return unique keywords, prioritizing compound and capitalized words
  return [...new Set([...compoundWords, ...capitalizedWords, ...words])].slice(0, 5);
}

// Helper function to calculate relevance score
function calculateRelevanceScore(
  repo: any,
  projectName: string,
  stories: string,
  keywords: string[]
): number {
  let score = 0;
  const repoText = `${repo.name} ${repo.description || ''} ${repo.topics?.join(' ') || ''}`.toLowerCase();

  // Check for project name match (highest weight)
  if (repoText.includes(projectName.toLowerCase())) {
    score += 0.4;
  }

  // Check for keyword matches
  keywords.forEach(keyword => {
    if (repoText.includes(keyword)) {
      score += 0.15;
    }
  });

  // Penalize if repo name/description is too generic
  const genericTerms = ['example', 'demo', 'test', 'sample', 'tutorial'];
  if (genericTerms.some(term => repo.name.toLowerCase().includes(term))) {
    score *= 0.5;
  }

  // Boost for repos with good documentation (has topics, good description)
  if (repo.topics && repo.topics.length > 0) {
    score += 0.1;
  }
  if (repo.description && repo.description.length > 50) {
    score += 0.1;
  }

  // Consider stars as a quality indicator (but not too heavily)
  if (repo.stargazers_count > 100) {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}

// Improved GitHub search function
async function searchGitHubRepos(projectName: string, domain: string, stories: string, count: number = 5) {
  const keywords = extractProjectKeywords(projectName, stories);
  console.log('Extracted keywords:', keywords);

  // Build more targeted search queries
  const searchQueries = [
    // Most specific: project name + key terms
    `"${projectName}" ${keywords[0] || domain}`,
    // Domain + first two keywords
    `${domain} ${keywords.slice(0, 2).join(' ')}`,
    // Just keywords in readme
    `${keywords.join(' ')} in:readme language:JavaScript language:Python language:Java`,
    // Domain + type of system
    `${domain} ${projectName.includes('repository') ? 'repository' : 'system'} stars:>10`,
    // Fallback: domain only with quality filter
    `${domain} stars:>50 archived:false`
  ];

  const allRepos: any[] = [];
  const seenRepoIds = new Set<number>();

  for (const query of searchQueries) {
    if (!query.trim()) continue;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`;

    console.log('GitHub search query:', query);

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'PersonaGenerator/1.0',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        console.error('GitHub search failed for query:', query, response.status);
        continue;
      }

      const data = await response.json();

      if (data.items && data.items.length > 0) {
        // Add repos we haven't seen yet
        data.items.forEach((repo: any) => {
          if (!seenRepoIds.has(repo.id)) {
            seenRepoIds.add(repo.id);
            allRepos.push(repo);
          }
        });
      }

      // Stop if we have enough repos
      if (allRepos.length >= count * 2) break;

    } catch (error) {
      console.error('GitHub search error for query:', query, error);
      continue;
    }
  }

  console.log(`Found ${allRepos.length} unique repos before filtering`);

  // Score and filter repos by relevance
  const scoredRepos = allRepos.map(repo => ({
    ...repo,
    relevanceScore: calculateRelevanceScore(repo, projectName, stories, keywords)
  }));

  // Sort by relevance and filter out low-relevance repos
  const relevantRepos = scoredRepos
    .filter(repo => repo.relevanceScore > 0.3) // Minimum relevance threshold
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, count);

  console.log(`Returning ${relevantRepos.length} relevant repos`);
  relevantRepos.forEach(repo => {
    console.log(`- ${repo.full_name} (score: ${repo.relevanceScore.toFixed(2)})`);
  });

  // If we don't have enough relevant repos, return what we have
  return relevantRepos.length > 0 ? relevantRepos : scoredRepos.slice(0, count);
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

// Helper function to generate requirements
async function generateRequirements(
  projectName: string,
  domain: string,
  stories: string,
  projectOutline: string,
  customRequirements?: string[]
): Promise<string[]> {
  try {
    const customReqContext = customRequirements && customRequirements.length > 0
      ? `\n\nINSTRUCTOR-PROVIDED REQUIREMENTS (MUST INCLUDE):\n${customRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : ''

    const requirementsPrompt = `Based on the project outline and context, generate a comprehensive list of project requirements.

Project: ${projectName}
Domain: ${domain}
Description: ${stories}

Project Outline:
${projectOutline}
${customReqContext}

Generate 8-12 specific, actionable requirements for this project. Include both functional and non-functional requirements.
Format each requirement as a clear, complete sentence starting with "The system must..." or "Users should be able to..."

${customRequirements && customRequirements.length > 0
  ? `IMPORTANT: Include all ${customRequirements.length} instructor-provided requirements in your list, integrating them naturally with the generated requirements.`
  : ''}

Return ONLY the requirements as a numbered list, no additional text.`

    const response = await cohere.chat({
      model: 'command-r-plus',
      message: requirementsPrompt,
      maxTokens: 500,
      temperature: 0.6,
    })

    const requirementsText = response.text?.trim() || ''

    // Parse the requirements from the response
    const requirements = requirementsText
      .split('\n')
      .filter(line => line.trim() && /^\d+\./.test(line.trim()))
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(req => req.length > 0)

    // If custom requirements were provided, ensure they're included
    if (customRequirements && customRequirements.length > 0) {
      const combinedRequirements = [...requirements]

      // Add any custom requirements that might not have been included
      customRequirements.forEach(customReq => {
        const isIncluded = combinedRequirements.some(req =>
          req.toLowerCase().includes(customReq.toLowerCase()) ||
          customReq.toLowerCase().includes(req.toLowerCase())
        )
        if (!isIncluded) {
          combinedRequirements.push(customReq)
        }
      })

      return combinedRequirements
    }

    return requirements.length > 0 ? requirements : [
      'The system must provide user authentication and authorization',
      'Users should be able to manage their profile information',
      'The system must ensure data security and privacy',
      'Users should be able to perform core domain-specific operations',
      'The system must provide an intuitive user interface',
      'The system must handle errors gracefully and provide meaningful feedback'
    ]

  } catch (error) {
    console.error('Error generating requirements:', error)

    // Return default requirements with custom ones if provided
    const defaultReqs = [
      'The system must provide user authentication and authorization',
      'Users should be able to manage their profile information',
      'The system must ensure data security and privacy',
      'Users should be able to perform core domain-specific operations',
      'The system must provide an intuitive user interface',
      'The system must handle errors gracefully and provide meaningful feedback'
    ]

    return customRequirements && customRequirements.length > 0
      ? [...customRequirements, ...defaultReqs]
      : defaultReqs
  }
}

// Helper function to generate default personas when AI fails
function generateDefaultPersonas(projectName: string, domain: string, count: number): any[] {
  const defaultRoles = {
    'Healthcare': ['Doctor', 'Nurse', 'Patient', 'Administrator', 'IT Manager'],
    'E-commerce': ['Customer', 'Store Owner', 'Product Manager', 'Support Agent', 'Developer'],
    'Education': ['Student', 'Instructor', 'Administrator', 'Parent', 'IT Support'],
    'Finance': ['Account Holder', 'Financial Advisor', 'Bank Manager', 'Auditor', 'Developer'],
    'Custom': ['End User', 'Project Manager', 'Administrator', 'Stakeholder', 'Developer']
  }

  const roles = defaultRoles[domain as keyof typeof defaultRoles] || defaultRoles['Custom']

  return roles.slice(0, count).map((role, i) => ({
    name: `${role} ${i + 1}`,
    initials: role.split(' ').map(w => w[0]).join(''),
    role: role,
    goal: `To effectively use ${projectName} for ${role.toLowerCase()} tasks`,
    concerns: `Ensuring ${projectName} meets ${role.toLowerCase()} needs and requirements`,
    personality: ['detail-oriented', 'practical', 'cautious', 'enthusiastic', 'analytical'][i] || 'professional'
  }))
}

export async function POST(req: Request) {
  try {
    // 1. Parse incoming request
    const { projectName, domain, stories, count, customRequirements } = await req.json()
    const effectiveDomain = domain?.trim() || 'General'

    console.log('=== PERSONA GENERATION REQUEST ===')
    console.log('Project Name:', projectName)
    console.log('Domain:', effectiveDomain)
    console.log('Description:', stories)
    console.log('Custom requirements provided:', customRequirements?.length || 0)

    // 2. Search for related GitHub repositories with improved relevance
    console.log('=== GITHUB SEARCH DEBUG ===')
    console.log('Searching for relevant GitHub repositories...')

    // Use the improved search function with project name
    const repos = await searchGitHubRepos(projectName, effectiveDomain, stories, 5)
    console.log('Relevant repositories found:', repos.length)

    // 3. Fetch README content from found repositories
    console.log('=== README FETCH DEBUG ===')
    console.log('Fetching README content from relevant repos...')
    const readmeContents: string[] = []
    const repoReferences: Array<{name: string, url: string, description: string, relevanceScore?: number}> = []

    for (const repo of repos) {
      console.log(`Processing repo: ${repo.full_name} (relevance: ${repo.relevanceScore?.toFixed(2) || 'N/A'})`)
      const readme = await fetchReadmeContent(repo.owner.login, repo.name)
      if (readme) {
        // Take first 1000 characters to avoid token limits
        readmeContents.push(readme.substring(0, 1000))
        console.log(`Added README content (${readme.length} chars) from ${repo.full_name}`)
      }

      repoReferences.push({
        name: repo.full_name,
        url: repo.html_url,
        description: repo.description || 'No description available',
        relevanceScore: repo.relevanceScore
      })
    }

    console.log('Total README contents collected:', readmeContents.length)
    console.log('Total repo references:', repoReferences.length)

    // 4. Generate project outline with better context
    const outlinePrompt = `Based on the project details and carefully selected related GitHub repositories, create a concise project outline (2-3 paragraphs) describing what this project is about:

Project Name: "${projectName}"
Domain: ${effectiveDomain}
Project Description: ${stories}

These are RELEVANT repositories found for similar projects (ordered by relevance):
${repoReferences.map(repo => `- ${repo.name}: ${repo.description}`).join('\n')}

${customRequirements && customRequirements.length > 0
  ? `\nCustom Requirements to Consider:\n${customRequirements.map((r: string) => `- ${r}`).join('\n')}`
  : ''}

Create a project outline that specifically describes the "${projectName}" project based on the given description, NOT a generic ${effectiveDomain} system.
Focus on the unique aspects mentioned in the project description.`

    const outlineResponse = await cohere.chat({
      model: 'command-r-plus',
      message: outlinePrompt,
      maxTokens: 300,
      temperature: 0.7,
    })

    const projectOutline = outlineResponse.text?.trim() || 'This project focuses on delivering solutions in the specified domain with attention to user needs and stakeholder requirements.'

    // 5. Generate requirements based on project outline
    const requirements = await generateRequirements(
      projectName,
      effectiveDomain,
      stories,
      projectOutline,
      customRequirements
    )

    // 6. Build enhanced persona generation prompt with specific project context
    const systemPrompt = `You are an expert at creating realistic stakeholder personas for software projects based on real-world examples and industry patterns.

Generate exactly ${count} realistic personas as a JSON array. Each persona should be an object with these exact fields:
- name (string): Full name
- initials (string): First and last name initials
- role (string): Their job title or role relevant to "${projectName}"
- goal (string): What they want to achieve with "${projectName}"
- concerns (string): What worries them or challenges they face regarding "${projectName}"
- personality (string): Brief personality description

IMPORTANT: Create personas specifically for the "${projectName}" project, not generic ${effectiveDomain} personas.

Return ONLY the JSON array, no other text.`

    const contextualPrompt = `Project: "${projectName}"
Domain: ${effectiveDomain}
Specific Project Context: ${stories}

${requirements.length > 0
  ? `\nKey Project Requirements:\n${requirements.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n')}`
  : ''}

Context from similar real projects:
${readmeContents.length > 0 ? readmeContents.join('\n\n---\n\n').substring(0, 2000) : 'No additional context available'}

Generate personas that would realistically be involved in the "${projectName}" project specifically.
Make sure their roles, goals, and concerns directly relate to: ${stories}`

    // 7. Call Cohere API for persona generation
    const response = await cohere.chat({
      model: 'command-r-plus',
      message: `${systemPrompt}\n\n${contextualPrompt}`,
      maxTokens: 1000,
      temperature: 0.8,
    })

    // 8. Extract and clean the response text
    let rawText = response.text?.trim() || ''
    rawText = rawText.replace(/```json\s*|\s*```/g, '').trim()

    // 9. Parse the JSON response
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

      // Fallback: create default personas relevant to the project
      personas = generateDefaultPersonas(projectName, effectiveDomain, count)
    }

    // 10. Return comprehensive response
    return NextResponse.json({
      personas: personas.slice(0, count),
      projectOutline,
      requirements,
      references: repoReferences.filter(ref => ref.relevanceScore && ref.relevanceScore > 0.3), // Only show relevant repos
      metadata: {
        projectName,
        searchQuery: `${projectName} ${effectiveDomain}`,
        reposFound: repos.length,
        readmesProcessed: readmeContents.length,
        averageRelevance: repos.length > 0
          ? repos.reduce((sum, r) => sum + (r.relevanceScore || 0), 0) / repos.length
          : 0
      }
    })

  } catch (error) {
    console.error('API error:', error)

    return NextResponse.json(
      {
        error: 'Failed to generate personas',
        personas: [],
        projectOutline: 'Error generating project outline',
        requirements: [],
        references: []
      },
      { status: 500 }
    )
  }
}