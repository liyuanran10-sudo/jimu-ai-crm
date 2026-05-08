FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY vendor/gpt-image2-ppt-skills/requirements.txt ./vendor/gpt-image2-ppt-skills/requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r ./vendor/gpt-image2-ppt-skills/requirements.txt

COPY . .

ENV NODE_ENV=production
ENV GPT_IMAGE_BACKEND=openai
ENV GPT_IMAGE_CONCURRENCY=1
ENV GPT_IMAGE_ENDPOINT=images
ENV GPT_IMAGE_MODEL_NAME=gpt-image-2
ENV GPT_IMAGE_SIZE=1792x1024

EXPOSE 3100

CMD ["npm", "start"]
