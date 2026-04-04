FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create the uploads directory
RUN mkdir -p uploads

# Make sure we can write to the uploads directory
RUN chmod 777 uploads

EXPOSE 5000

ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=app.py

CMD ["python", "app.py"]