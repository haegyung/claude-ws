# Docker Deployment Guide for Claude Workspace

This guide explains how to deploy Claude Workspace using Docker and Docker Compose.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB RAM available for Docker
- 2GB free disk space

## Quick Start

### 1. Using Make (Recommended)

The easiest way to manage the Docker deployment:

```bash
# Interactive setup with API key generation the application
make setup-docker  # Interactive setup with secure API key generation
make up       # Start containers

# View logs
make logs

# Check status
make ps
```

### 2. Using Docker Compose Directly

```bash
# Interactive setup with API key generation
./docker-setup.sh  # or: cp .env.docker.example .env docker-compose up -d --builddocker-compose up -d --build nano .env
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Configuration

### Environment Variables

### Environment Variables

The application uses a `.env` file for configuration:

1. **Copy the example file:**
   ```bash
   cp .env.docker.example .env
   ```

2. **Edit `.env` with your values:**
   ```bash
   # Required: API Authentication
   API_ACCESS_KEY=your-secure-api-key-here

   # Optional: Anthropic API credentials (used by shared-llm-proxy)
   # ANTHROPIC_AUTH_TOKEN=
   # ANTHROPIC_API_KEY=sk-ant-api03-...
   # ANTHROPIC_PROXIED_BASE_URL=https://api.anthropic.com

   # Shared proxy for pooled project containers
   SHARED_LLM_PROXY_PORT=8666
   SHARED_LLM_PROXY_URL=http://shared-llm-proxy:8666/api/proxy/anthropic
   POOL_DOCKER_NETWORK=claude-network

   # Server Configuration
   PORT=8053
   NODE_ENV=production
   ```

**⚠️ Important:** Always set a secure `API_ACCESS_KEY` in production!

Or use the automated setup:
```bash
make setup  # This will create .env from .env.docker.example
```

### Port Configuration

Default port is `8053`. To change:

```yaml
ports:
  - "3000:8053"  # Maps localhost:3000 to container:8053
```

## Common Commands

### Using Makefile

```bash
make help          # Show all available commands
make build         # Build Docker image
make up            # Start containers
make down          # Stop containers
make restart       # Restart containers
make logs          # Show logs
make shell         # Open shell in container
make clean         # Remove everything
make rebuild       # Rebuild from scratch
make health        # Check application health
make test          # Run API tests
```

### Using Docker Compose

```bash
# Build
docker-compose build

# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart

# Logs
docker-compose logs -f claude-workspace

# Execute command in container
docker-compose exec claude-workspace sh

# Show running containers
docker-compose ps

# Resource usage
docker-compose stats
```

## Data Persistence

Data is persisted in a Docker volume named `claude-data`:

```bash
# View volumes
docker volume ls

# Inspect volume
docker volume inspect claude-data

# Backup data
docker run --rm -v claude-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/claude-data-backup.tar.gz /data

# Restore data
docker run --rm -v claude-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/claude-data-backup.tar.gz -C /
```

## Health Checks

The containers include health checks:

```bash
# Check health status
docker-compose ps
docker inspect claude-workspace | jq '.[0].State.Health'
docker inspect shared-llm-proxy | jq '.[0].State.Health'

# Manual health check
curl http://localhost:8053/api/health
# Internal shared proxy health (from container network)
docker-compose exec claude-workspace wget -qO- http://shared-llm-proxy:8666/health
```

## Troubleshooting

### Container won't start

```bash
# Check logs
make logs

# Check resource usage
docker-compose stats

# Rebuild from scratch
make clean
make build
make up
```

### Port already in use

```bash
# Find process using port 8053
lsof -ti:8053

# Kill process
kill -9 $(lsof -ti:8053)

# Or change port in docker-compose.yml
```

### Permission issues

```bash
# Fix file permissions
docker-compose exec -u root claude-workspace chown -R nextjs:nodejs /app/data
```

### Out of memory

```bash
# Increase Docker memory limit in Docker Desktop settings
# Or add memory limits to docker-compose.yml:
services:
  claude-ws:
    deploy:
      resources:
        limits:
          memory: 2G
```

## Production Deployment

### Security Recommendations

1. **Set secure API key** in `.env` file (create from `.env.docker.example`)
2. **Use secrets** for sensitive data:
   ```yaml
   secrets:
     anthropic_api_key:
       file: ./secrets/anthropic_api_key.txt
   ```
3. **Enable HTTPS** using a reverse proxy (nginx/traefik)
4. **Restrict network access**:
   ```yaml
   networks:
     claude-network:
       driver: bridge
       ipam:
         config:
           - subnet: 172.20.0.0/16
   ```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8053;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Docker Swarm / Kubernetes

For orchestration, convert docker-compose.yml to:

- **Docker Swarm**: `docker stack deploy -c docker-compose.yml claude-ws`
- **Kubernetes**: Use Kompose (`kompose convert`)

## Monitoring

### Logs

```bash
# Follow logs
docker-compose logs -f

# Logs since specific time
docker-compose logs --since 2024-01-01T00:00:00

# Last 100 lines
docker-compose logs --tail=100
```

### Metrics

```bash
# Container stats
docker stats claude-workspace

# Disk usage
docker system df

# Image sizes
docker images | grep claude-workspace
```

## Updates

```bash
# Pull latest changes
git pull

# Rebuild and restart
make rebuild
```

## Development

### Development Mode with Hot Reload

```bash
# Use local development instead of Docker
make local-dev
```

### Debugging

```bash
# Open shell in container
make shell

# View environment variables
docker-compose exec claude-workspace env

# Check file system
docker-compose exec claude-workspace ls -la /app
```

## API Testing

After starting the container:

```bash
# Run API tests
make test

# Or manually
curl -H "x-api-key: demo-key" http://localhost:8053/api/search/files?basePath=/app&limit=10
```

## Backup and Restore

### Backup

```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker run --rm \
  -v claude-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/claude-backup-$DATE.tar.gz /data
EOF

chmod +x backup.sh
./backup.sh
```

### Restore

```bash
docker run --rm \
  -v claude-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/claude-backup-DATE.tar.gz -C /
```

## Support

For issues and questions:
- GitHub: https://github.com/Claude-Workspace/claude-ws/issues
- Documentation: See README.md

## License

MIT License - See LICENSE file for details
