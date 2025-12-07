#!/bin/bash

echo "📁 Checking current directory..."
pwd
echo ""

echo "🔍 Checking git status..."
git status
echo ""

echo "📊 Checking what files would be added..."
git add . --dry-run | head -20
echo ""

echo "📋 Listing all files in project..."
find . -type f -not -path "./.git/*" | grep -v node_modules | head -30
echo ""

echo "➕ Adding all files (force)..."
git add -f .
echo ""

echo "📦 Checking staged files..."
git status --porcelain | head -30
echo ""

echo "💾 Committing files..."
git commit -m "feat: Complete Airtable Form Builder application

- Backend: Express.js with MongoDB integration
- Frontend: React with Tailwind CSS
- Airtable OAuth authentication
- Dynamic form builder with conditional logic
- Webhook synchronization
- Docker deployment setup
- Complete API documentation"
echo ""

echo "🚀 Pushing to GitHub..."
git push origin main
echo ""

echo "✅ Done! Check your GitHub repository."
echo "📎 URL: https://github.com/dhiraj-eng07/Airtable-Connected-Dynamic-Form-Builder-"