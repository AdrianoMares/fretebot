FROM node:20-slim

# Instala dependências necessárias para o Chrome
RUN apt-get update && apt-get install -y     wget     gnupg     ca-certificates     fonts-liberation     libasound2     libatk-bridge2.0-0     libatk1.0-0     libc6     libcairo2     libcups2     libdbus-1-3     libexpat1     libfontconfig1     libgbm1     libglib2.0-0     libgtk-3-0     libnspr4     libnss3     libpango-1.0-0     libx11-6     libx11-xcb1     libxcb1     libxcomposite1     libxcursor1     libxdamage1     libxext6     libxfixes3     libxi6     libxrandr2     libxrender1     libxss1     libxtst6     lsb-release     xdg-utils     && rm -rf /var/lib/apt/lists/*

# Define diretório de trabalho
WORKDIR /usr/src/app

# Copia arquivos do projeto
COPY package*.json ./
RUN npm install

COPY . .

# Instala Chrome para o Puppeteer
RUN npx puppeteer browsers install chrome

# Define variável de ambiente para o Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Expõe a porta usada pela aplicação
EXPOSE 10000

# Inicia o servidor
CMD ["npm", "start"]
