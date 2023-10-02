# Choose the latest LTS (Long Term Support) version of node as our base image
FROM node:lts@sha256:ee0a21d64211d92d4340b225c556e9ef1a8bce1d5b03b49f5f07bf1dbbaa5626

ARG PROJECT_ROOT="."

# Create a directory for our application
WORKDIR /app

# Copy only the build artifact and package.json into our app directory
COPY ${PROJECT_ROOT}/dist .
COPY ${PROJECT_ROOT}/package .

# Install only production dependencies
RUN npm install --omit=dev --silent

# The application's default port is picked from the environment
EXPOSE $PORT

# Start the application
CMD [ "node", "app.js" ]
