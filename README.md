# 🎭 Persona Simulation for Requirements Elicitation

<div align="center">
  
# 🔴 **LIVE DEMO: [https://persona-sim-fresh-zmi2.vercel.app/](https://persona-sim-fresh-zmi2.vercel.app/)** 🔴

[![Live Demo](https://img.shields.io/badge/🚀_Try_Live_Demo-red?style=for-the-badge)](https://persona-sim-fresh-zmi2.vercel.app/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Cohere](https://img.shields.io/badge/Cohere-AI-purple?style=for-the-badge)](https://cohere.ai/)

*AI-powered stakeholder simulation for teaching requirements elicitation*

</div>

---

## 🚀 Quick Start

**The application is already deployed! Visit: [https://persona-sim-fresh-zmi2.vercel.app/](https://persona-sim-fresh-zmi2.vercel.app/)**

```bash
# For local development only:
git clone https://github.com/jiao2560/persona-sim-fresh.git
cd persona-sim-fresh
npm install
cp .env.example .env.local
# Add your CO_API_KEY to .env.local
npm run dev
```

> 📸 **Image needed**: Screenshot of the landing page showing the instructor dashboard button

---

## 📋 Table of Contents

- [What is This?](#-what-is-this)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [How It Works](#-how-it-works)
- [API Routes](#-api-routes)
- [Local Development](#-local-development)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [Contributing](#-contributing)

---

## 🎯 What is This?

A web application that generates AI-powered stakeholder personas from project descriptions. Students practice requirements elicitation by interviewing these personas, while instructors track progress through a dashboard.

**Key Problems Solved:**
- Students can't practice with real stakeholders
- Role-playing lacks consistency
- Instructors need scalable teaching tools

> <img width="1914" height="888" alt="image" src="https://github.com/user-attachments/assets/6ad10728-d37d-46b2-9452-2c5819171d39" />


---

## ✨ Features

### Core Functionality
- **🤖 AI Persona Generation**: Creates realistic stakeholders from project descriptions
- **🔍 GitHub-Informed Context**: Analyzes real repositories for authentic personas
- **💬 Multi-Agent Interviews**: Students can interview multiple personas simultaneously
- **🤝 Collaborative Discussions**: Personas can discuss requirements together
- **📊 Coverage Analysis**: Automated assessment of requirement completeness
- **📈 Instructor Dashboard**: Real-time monitoring of student progress
- **💾 Session Management**: Archive and review past interviews

### Technical Features
- **Memory Persistence**: Personas remember previous interactions
- **Role Boundaries**: Each persona only knows domain-appropriate information
- **Dynamic Routing**: LangGraph orchestrates multi-agent conversations
- **Quality Metrics**: Automated scoring of questions and coverage

> <img width="1591" height="878" alt="image" src="https://github.com/user-attachments/assets/5c6ea8ee-26e6-4cc3-a5e9-567ba510a131" />


---

## 🛠 Tech Stack

```
Frontend:
├── Next.js 14 (App Router)
├── React 18
├── TypeScript
└── Tailwind CSS

Backend:
├── Next.js API Routes
├── Cohere AI (Command R+ Model)
└── LangGraph (Multi-agent orchestration)

Infrastructure:
├── Vercel (Hosting)
└── GitHub API (Repository analysis)
```

> 📸 **Image needed**: Architecture diagram showing data flow from instructor → personas → students → analytics

---

## 📁 Project Structure

```
persona-sim-fresh/
├── app/
│   ├── page.tsx                    # Landing page (instructor entry)
│   ├── personas/
│   │   └── page.tsx                # Persona management & display
│   ├── interview/
│   │   └── page.tsx                # Student interview interface
│   ├── instructor-dashboard/
│   │   └── page.tsx                # Progress monitoring
│   ├── api/
│   │   ├── generate-personas/      # Persona generation endpoint
│   │   ├── interview/              # Multi-agent chat endpoint
│   │   ├── extract-requirements/   # Requirement extraction
│   │   ├── requirement-coverage/   # Coverage analysis
│   │   ├── session-storage/        # Session persistence
│   │   └── instructor-dashboard/   # Dashboard data endpoint
│   └── components/
│       └── Navigation.tsx          # Shared navigation component
├── public/                         # Static assets
├── .env.local                      # Environment variables
└── package.json
```

---

## 🔄 How It Works

### 1. Persona Generation Flow
```typescript
// Instructor provides:
{
  projectName: "Patient Portal",
  domain: "Healthcare",
  stories: "A system for patients to access records...",
  count: 3
}

// System:
1. Searches GitHub for similar projects
2. Analyzes README files for context
3. Generates personas with Cohere AI
4. Returns personas with roles, goals, concerns
```

> 📸 **Image needed**: Flow diagram showing persona generation process

### 2. Interview Session Flow
```typescript
// Student selects personas → Asks questions → Personas respond
// LangGraph manages:
- Message routing
- Memory persistence  
- Role boundaries
- Collaborative discussions
```

> 📸 **Image needed**: Screenshot of chat interface with persona responses

### 3. Coverage Analysis
```typescript
// System analyzes:
- Question quality (1-5 scale)
- Requirements discovered
- Coverage percentage
- Generates feedback report
```

> 📸 **Image needed**: Screenshot of coverage analysis report

---

## 🔌 API Routes

### `/api/generate-personas` (POST)
Generates personas from project description
```typescript
Request: {
  projectName: string
  domain: string
  stories: string
  count: number
  customRequirements?: string[]
}

Response: {
  personas: Persona[]
  projectOutline: string
  requirements: string[]
  references: GitHubRepo[]
}
```

### `/api/interview` (POST)
Handles multi-agent chat orchestration
```typescript
Request: {
  message: string
  personas: Persona[]
  conversationHistory: Message[]
  sessionId?: string
}

Response: {
  responses: PersonaResponse[]
  metadata: SessionMetadata
}
```

### `/api/requirement-coverage` (POST)
Analyzes requirement coverage from interview
```typescript
Request: {
  messages: Message[]
  projectRequirements: string[]
  studentName: string
  sessionId: string
}

Response: {
  overallCoverageRate: number
  questionQualityScore: number
  strengths: string[]
  improvements: string[]
}
```

> 📸 **Image needed**: API flow diagram or Postman/Insomnia screenshot

---

## 💻 Local Development

### Prerequisites
- Node.js 18+
- npm/yarn
- Cohere API key ([Get one here](https://dashboard.cohere.ai/))

### Setup Steps

1. **Clone and install:**
```bash
git clone https://github.com/jiao2560/persona-sim-fresh.git
cd persona-sim-fresh
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env.local
```

3. **Add your Cohere API key to `.env.local`:**
```env
CO_API_KEY=your_cohere_api_key_here
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

4. **Run development server:**
```bash
npm run dev
```

5. **Open [http://localhost:3000](http://localhost:3000)**

### Development Commands
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
npm run type-check  # Run TypeScript compiler
```

---

## 🔐 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `CO_API_KEY` | Cohere API key for AI generation | ✅ Yes | - |
| `NEXT_PUBLIC_BASE_URL` | Base URL for API calls | ✅ Yes | http://localhost:3000 |
| `NODE_ENV` | Environment mode | No | development |

### Getting a Cohere API Key
1. Visit [https://dashboard.cohere.ai/](https://dashboard.cohere.ai/)
2. Sign up/login
3. Navigate to API Keys
4. Create a new key (Production recommended)
5. Copy and add to `.env.local`

> 📸 **Image needed**: Screenshot of Cohere dashboard API keys section

---

## 🚀 Deployment

### Current Deployment
**Already deployed at: [https://persona-sim-fresh-zmi2.vercel.app/](https://persona-sim-fresh-zmi2.vercel.app/)**

### Deploy Your Own Instance

#### Option 1: One-Click Deploy
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jiao2560/persona-sim-fresh&env=CO_API_KEY&envDescription=Cohere%20API%20Key&envLink=https://dashboard.cohere.ai/)

#### Option 2: Manual Deployment
1. Fork this repository
2. Import to Vercel
3. Add environment variables:
   - `CO_API_KEY`: Your Cohere API key
   - `NEXT_PUBLIC_BASE_URL`: Your deployment URL
4. Deploy!

### Production Considerations
- Enable Vercel Analytics for monitoring
- Set up error tracking (e.g., Sentry)
- Configure rate limiting for API routes
- Monitor Cohere API usage

> 📸 **Image needed**: Vercel deployment settings screenshot

---

## 🤝 Contributing

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch:**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Commit with clear messages:**
   ```bash
   git commit -m "Add: Persona difficulty levels"
   ```
5. **Push to your fork:**
   ```bash
   git push origin feature/amazing-feature
   ```
6. **Open a Pull Request**

### Areas for Improvement

- [ ] Add visual avatars for personas
- [ ] Implement difficulty levels
- [ ] Add more domain templates
- [ ] Improve mobile responsiveness
- [ ] Add export to PDF functionality
- [ ] Implement real-time collaboration
- [ ] Add internationalization support

### Code Style
- Use TypeScript strict mode
- Follow Next.js best practices
- Keep components small and focused
- Add comments for complex logic
- Write tests for new features

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file

---

## 🙏 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- AI powered by [Cohere](https://cohere.ai/)
- Multi-agent orchestration via [LangGraph](https://github.com/langchain-ai/langgraph)
- Deployed on [Vercel](https://vercel.com/)

---

<div align="center">

### 🌟 Ready to try it out?

# [👉 Launch the App](https://persona-sim-fresh-zmi2.vercel.app/) 👈

*Questions? Issues? [Open an issue](https://github.com/jiao2560/persona-sim-fresh/issues)*

</div>

