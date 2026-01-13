# Deployment Guide: Replit → Flight Control → AWS

This guide explains how to deploy the Sirius application using a Replit development, Flight Control CI/CD, and AWS production pipeline.

## Overview

```
┌─────────────┐     ┌──────────┐     ┌────────────────┐     ┌─────────────┐
│   Replit    │ ──► │  GitHub  │ ──► │ Flight Control │ ──► │  AWS (ECS)  │
│ Development │     │   Repo   │     │   CI/CD        │     │  Production │
└─────────────┘     └──────────┘     └────────────────┘     └─────────────┘
```

## Prerequisites

1. **Replit Account** - For development environment
2. **GitHub Account** - For source code repository
3. **Flight Control Account** - Sign up at https://app.flightcontrol.dev
4. **AWS Account** - For production infrastructure

## Architecture

### Development (Replit)
- Uses Replit Auth for authentication
- Connects to Replit-managed PostgreSQL (Neon-backed)
- Hot reloading with Vite
- Port 5000 for the application

### Production (AWS via Flight Control)
- Containerized deployment on AWS ECS/Fargate
- AWS RDS PostgreSQL for database
- AWS ALB for load balancing with HTTPS
- Port 8080 internally (mapped to 443 externally)

## Setup Steps

### 1. Connect GitHub Repository

Push your Replit project to GitHub:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Configure Flight Control

1. Sign in to https://app.flightcontrol.dev
2. Create a new project
3. Connect your GitHub repository
4. Connect your AWS account (follow Flight Control's AWS setup wizard)
5. Select the repository and branch to deploy

### 3. Configure Environment Variables

In Flight Control dashboard, add these secrets:

**Required:**
- `DATABASE_URL` - (Auto-provided by Flight Control RDS)
- `SESSION_SECRET` - Secure random string (min 32 chars)
- `AUTH_PROVIDER` - Set to `cognito` or `oidc` for production

**For AWS Cognito Auth (if using):**
- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `COGNITO_CLIENT_SECRET`
- `COGNITO_DOMAIN`

**Optional Services:**
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`
- `SENDGRID_API_KEY`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (for S3)

### 4. Deploy

Once configured, Flight Control will:
1. Build the Docker image
2. Push to AWS ECR
3. Deploy to AWS ECS/Fargate
4. Configure load balancer and SSL
5. Run health checks

## Configuration Files

### flightcontrol.json

The `flightcontrol.json` file at the root defines:
- Environments (production, staging)
- Services (app, database)
- Build and runtime configuration
- Resource allocation

### Dockerfile

The `Dockerfile` defines:
- Node.js 20 base image
- Build steps (npm install, npm build)
- Runtime configuration
- Health check endpoint

## Authentication

### Development (Replit Auth)
Uses Replit's OIDC provider. Works automatically when `REPL_ID` is set.

### Production Options

1. **AWS Cognito** (Recommended)
   - Set `AUTH_PROVIDER=cognito`
   - Configure Cognito environment variables
   - Create user pool in AWS Console

2. **Generic OIDC Provider**
   - Set `AUTH_PROVIDER=oidc`
   - Configure OIDC environment variables
   - Works with Auth0, Okta, etc.

## Database

### Development
- Uses Replit's PostgreSQL (Neon-backed)
- Connection via `DATABASE_URL`

### Production Options

**Option 1: Continue with Neon (Recommended)**
- Create a Neon project at https://neon.tech
- Use Neon's connection string as `DATABASE_URL` in Flight Control
- No code changes required - app already uses Neon driver
- Benefits: Serverless scaling, branching, built-in connection pooling

**Option 2: AWS RDS PostgreSQL**
- Flight Control can provision AWS RDS
- Add RDS service to `flightcontrol.json`
- May require updating `server/db.ts` to use standard `pg` driver instead of Neon driver
- Benefits: Fully AWS-native, VPC integration

For simplest migration, we recommend continuing with Neon since the application already uses the Neon serverless driver.

## Monitoring

### Health Checks
- Endpoint: `/api/health`
- Returns server status, uptime, environment

### Logs
- View in Flight Control dashboard
- CloudWatch integration available

## Environments

### Production (`main` branch)
- Auto-deploys on push to main
- Full resources (0.5 vCPU, 1GB RAM)
- Auto-scaling 1-3 instances

### Staging (`develop` branch)
- Auto-deploys on push to develop
- Minimal resources (0.25 vCPU, 0.5GB RAM)
- Single instance

## Troubleshooting

### Build Failures
- Check Flight Control build logs
- Verify all dependencies in package.json
- Ensure Dockerfile syntax is correct

### Runtime Errors
- Check application logs in Flight Control
- Verify all environment variables are set
- Check database connectivity

### Health Check Failures
- Verify `/api/health` endpoint responds
- Check application startup logs
- Ensure PORT is set to 8080

## Costs

### Flight Control
- Free tier available
- Starter: $49/month

### AWS (Pay-as-you-go)
- ECS/Fargate compute costs
- RDS database costs
- ALB costs
- Data transfer

Estimated: ~$30-100/month for small-medium workloads.

## Support

- Flight Control Docs: https://www.flightcontrol.dev/docs
- Flight Control Support: Built-in chat support
- AWS Support: Based on support plan
