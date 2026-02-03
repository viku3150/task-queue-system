## ⚖️ Design Trade-offs (Why I Chose This)

### PostgreSQL as the Queue

**Pros**
- Durable and restart-safe  
- Easy to query for dashboard and metrics  
- No additional queue system required  

**Cons**
- Polling can put load on the database  
- Not ideal for very high-throughput workloads  

---

### Polling Workers

**Pros**
- Simple to implement  
- Reliable for prototypes and internal tools  

**Cons**
- Higher latency than push-based queues  
- Requires tuning (poll interval, indexes, batch size)  

---

### Redis for Rate Limiting

**Pros**
- Extremely fast  
- Clean sliding-window rate limit implementation  

**Cons**
- Extra infrastructure dependency  
- Must choose fail-open vs fail-closed behavior if Redis is unavailable  


---

## ⚡ Quick Start

### 1) Prerequisites

Make sure you have installed:

- Node.js  
- PostgreSQL  
- Redis  

---

### 2) Install Dependencies

```bash
npm install
```

### 3) Create a .env file in the project root:

```bash
DATABASE_URL="postgresql://YOUR_USER@localhost:5432/task_queue?schema=public"
REDIS_URL="redis://localhost:6379"
PORT=3000
```

### 4) Create Database & Run Migrations
```bash
createdb task_queue
npx prisma migrate dev --name init
npx prisma generate
```

### 5) Run the application
```bash
npm run dev
```

### 6) Access the Prisma studio
```bash
npx prisma studio
```

### Access the end points
| Service       | URL                                                                          |
| ------------- | ---------------------------------------------------------------------------- |
| API           | [http://localhost:3000/api/v1](http://localhost:3000/api/v1)                 |
| Dashboard     | [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html) |
| Prisma Studio | [http://localhost:5555](http://localhost:5555)                               |
