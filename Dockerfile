FROM python:3.12-slim

# تثبيت حزم النظام الرسومية والـ OpenGL المطلوبة لتشغيل gmsh
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglu1-mesa \
    libglib2.0-0 \
    libsm6 \
    libxcursor1 \
    libxext6 \
    libxi6 \
    libxinerama1 \
    libxrandr2 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY docker-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py physics_solver.py universal_dispatcher.py ./
COPY backend/report_generator.py ./backend/report_generator.py

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]