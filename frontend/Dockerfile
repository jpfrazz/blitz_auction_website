FROM node:25-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.29-trixie AS runner

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx.nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
