#!/usr/bin/env node

/**
 * Helper script to get your Asana Workspace GID
 * Usage: node get-asana-workspace.js
 */

const axios = require('axios')
require('dotenv').config()

const ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN || '2/568120696269174/1212643658293191:dcbc9bc31c12d69e734c2120053ebea3'

async function getWorkspaceGID() {
  try {
    console.log('🔍 Fetching Asana workspace information...\n')
    
    const response = await axios.get('https://app.asana.com/api/1.0/users/me', {
      headers: {
        'Authorization': `Bearer ${ASANA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })
    
    const user = response.data.data
    const workspaces = user.workspaces || []
    
    console.log('✅ Successfully connected to Asana!\n')
    console.log('👤 User:', user.name)
    console.log('📧 Email:', user.email || 'N/A')
    console.log('\n📋 Available Workspaces:\n')
    
    if (workspaces.length === 0) {
      console.log('⚠️  No workspaces found. Make sure your access token has the correct permissions.')
      return
    }
    
    workspaces.forEach((workspace, index) => {
      console.log(`${index + 1}. ${workspace.name}`)
      console.log(`   GID: ${workspace.gid}`)
      console.log('')
    })
    
    if (workspaces.length === 1) {
      console.log('💡 Add this to your .env file:')
      console.log(`ASANA_WORKSPACE_GID=${workspaces[0].gid}`)
    } else {
      console.log('💡 Choose a workspace and add its GID to your .env file:')
      console.log('ASANA_WORKSPACE_GID=<workspace-gid-from-above>')
    }
    
  } catch (error) {
    console.error('❌ Error fetching workspace information:')
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Error:', JSON.stringify(error.response.data, null, 2))
      if (error.response.status === 401) {
        console.error('\n⚠️  Authentication failed. Please check your ASANA_ACCESS_TOKEN.')
      }
    } else {
      console.error('Message:', error.message)
    }
    process.exit(1)
  }
}

// Also try to get projects if workspace is configured
async function getProjects() {
  const workspaceGid = process.env.ASANA_WORKSPACE_GID
  
  if (!workspaceGid || workspaceGid === 'your-asana-workspace-gid-here') {
    return
  }
  
  try {
    console.log('\n📁 Fetching projects in workspace...\n')
    
    const response = await axios.get(`https://app.asana.com/api/1.0/workspaces/${workspaceGid}/projects`, {
      headers: {
        'Authorization': `Bearer ${ASANA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      params: {
        opt_fields: 'gid,name',
        limit: 50
      }
    })
    
    const projects = response.data.data || []
    
    if (projects.length > 0) {
      console.log('Available Projects:')
      projects.forEach((project, index) => {
        console.log(`${index + 1}. ${project.name}`)
        console.log(`   GID: ${project.gid}`)
        console.log('')
      })
      
      console.log('💡 Optional: Add a project GID to your .env file:')
      console.log('ASANA_PROJECT_GID=<project-gid-from-above>')
    } else {
      console.log('No projects found in this workspace.')
    }
    
  } catch (error) {
    console.log('\n⚠️  Could not fetch projects (this is optional)')
  }
}

// Run the script
getWorkspaceGID()
  .then(() => getProjects())
  .catch(error => {
    console.error('Unexpected error:', error)
    process.exit(1)
  })

