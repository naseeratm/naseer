FROM ubuntu:24.04

# تثبيت أدوات التصنيع والشبكة والمحركات الهندسية المستخدمة داخل العامل.
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
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
    gmsh \
    openfoam \
    calculix-ccx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY docker-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py physics_solver.py universal_dispatcher.py ./
COPY backend/report_generator.py ./backend/report_generator.py

CMD ["/opt/venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]