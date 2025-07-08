FROM node:lts-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends git bash coreutils && \
    rm -rf /var/lib/apt/lists/*

COPY . .
WORKDIR /app/gemini-cli
RUN npm install

WORKDIR /app
RUN cp -r bridge-server gemini-cli/packages/ && \
    cp LICENSE README.md gemini-cli/packages/bridge-server/ && \
    cd gemini-cli/packages/bridge-server && npm install && npm run build

WORKDIR /app/gemini-cli/packages/bridge-server
EXPOSE 8765
CMD ["npm", "run", "start"]
