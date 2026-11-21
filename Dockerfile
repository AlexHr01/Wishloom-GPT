FROM python:3.12-slim
WORKDIR /app
COPY app.py ./
COPY static ./static
COPY favicon.svg ./
RUN mkdir -p /app/data && useradd --create-home --uid 10001 wishloom && chown -R wishloom:wishloom /app/data
ENV HOST=0.0.0.0 PORT=8080 WISHLOOM_DB=/app/data/wishloom.sqlite3 PYTHONUNBUFFERED=1
USER wishloom
EXPOSE 8080
CMD ["python", "app.py"]
