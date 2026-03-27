FROM node:20-alpine

WORKDIR /app

COPY server.js ./server.js

ENV SHARED_LLM_PROXY_PORT=8666
ENV SHARED_LLM_PROXY_HOST=0.0.0.0

EXPOSE 8666

CMD ["node", "server.js"]
