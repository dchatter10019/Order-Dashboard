#!/usr/bin/env node

/**
 * Check projects in a specific Asana workspace
 */

const axios = require('axios')
require('dotenv').config()

const ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN || '2/568120696269174/1212643658293191:dcbc9bc31c12d69e734c2120053ebea3'
const WORKSPACE_GID = '568125763781596'

async function getProjects() {
  try {
    console.log(`📁 Fetching projects in workspace ${WORKSPACE_GID}...\n`)
    
    const response = await axios.get(`https://app.asana.com/api/1.0/workspaces/${WORKSPACE_GID}/projects`, {
      headers: {
        'Authorization': `Bearer ${ASANA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      params: {
        opt_fields: 'gid,name,archived',
        limit: 100
      }
    })
    
    const projects = response.data.data || []
    
    if (projects.length > 0) {
      const activeProjects = projects.filter(p => !p.archived)
      const archivedProjects = projects.filter(p => p.archived)
      
      console.log(`✅ Found ${projects.length} total projects\n`)
      
      if (activeProjects.length > 0) {
        console.log('📋 Active Projects:')
        activeProjects.forEach((project, index) => {
          console.log(`${index + 1}. ${project.name}`)
          console.log(`   GID: ${project.gid}`)
          console.log('')
        })
        
        console.log('💡 Add this to your .env file (optional):')
        console.log(`ASANA_PROJECT_GID=${activeProjects[0].gid}`)
        console.log('')
      }
      
      if (archivedProjects.length > 0) {
        console.log(`📦 Archived Projects (${archivedProjects.length}):`)
        archivedProjects.slice(0, 5).forEach((project, index) => {
          console.log(`${index + 1}. ${project.name} (archived)`)
        })
        if (archivedProjects.length > 5) {
          console.log(`   ... and ${archivedProjects.length - 5} more`)
        }
      }
    } else {
      console.log('⚠️  No projects found in this workspace.')
      console.log('   Tasks will be created without a project assignment.')
    }
    
  } catch (error) {
    console.error('❌ Error fetching projects:')
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Error:', JSON.stringify(error.response.data, null, 2))
    } else {
      console.error('Message:', error.message)
    }
  }
}

getProjects()

