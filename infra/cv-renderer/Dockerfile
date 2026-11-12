FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 libreoffice-writer fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chmod=0444 server.py .
USER 65534:65534
ENV HOME=/tmp PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python3", "/app/server.py"]
