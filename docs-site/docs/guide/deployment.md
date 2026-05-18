# Deployment

Deploying the iGames Framework requires careful handling of MongoDB Replicasets and Redis instances to maintain transaction support and distributed locking.

## Production Requirements

- **MongoDB Replicaset**: Single-node MongoDB deployments *do not* support Multi-Document ACID Transactions (`ClientSession`). You **must** deploy MongoDB as a Replicaset. (e.g., MongoDB Atlas).
- **Redis Cluster**: Highly recommended to deploy Redis in a highly available cluster topology to prevent lock failures and ensure Socket.io Pub/Sub adapter stability.
- **Node Environment**: Always set `NODE_ENV=production` to disable debug logging and enable caching mechanisms.

## Build Steps

```bash
# Backend
npm install
npm run build
npm run start:prod

# Frontend
cd frontend
npm install
npm run build
```

## Scaling the Backend

The framework is strictly **stateless** (except for Redis/Mongo). You can spin up as many backend containers as necessary.

1. **Load Balancer**: Place the API behind an Nginx or AWS ALB balancer.
2. **WebSockets**: Ensure sticky sessions are enabled on the Load Balancer, or rely entirely on `@socket.io/redis-adapter` for message propagation across the cluster.
3. **Schedulers**: Schedulers are perfectly safe to run horizontally. The `RedisLockService` ensures that only one container handles a game settlement interval, preventing double payouts.

## PM2 Ecosystem Example

If deploying on a VPS without Docker, PM2 is recommended to auto-manage shutdown hooks. NestJS gracefully processes `SIGINT` inside `main.ts` (`app.enableShutdownHooks()`).

```js
module.exports = {
  apps: [{
    name: "igames-api",
    script: "./dist/main.js",
    instances: "max",
    exec_mode: "cluster",
    env_production: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
}
```
