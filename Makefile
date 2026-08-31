# ─────────────────────────────────────────────────────────────
# AgriSaarthi V1 — Root Build Orchestrator
# ─────────────────────────────────────────────────────────────
.DEFAULT_GOAL := help
SHELL := /bin/bash

ENGINE_DIR   := mandi-engine
GATEWAY_DIR  := backend-gateway
ML_DIR       := ml-microservice
WEB_DIR      := frontend
BUILD_TYPE   ?= Release
PYTHON       ?= python3

# Portable venv python path — Windows venvs use Scripts/, POSIX uses bin/.
# Override with `make install PYTHON=python3.12` if you have multiple interpreters.
ifeq ($(OS),Windows_NT)
  VENV_PY := .venv/Scripts/python.exe
else
  VENV_PY := .venv/bin/python
endif

.PHONY: help install build engine gateway ml web train dev clean test verify-engine ingest ingest-pdf

help:
	@echo "AgriSaarthi V1 — targets"
	@echo "  make install   Install all dependencies (C++ toolchain assumed present)"
	@echo "  make build     Build C++ engine + gateway TS + frontend"
	@echo "  make engine    Configure & compile the C++ mandi router"
	@echo "  make train     Train and export the leaf-disease SVM artifact"
	@echo "  make dev       Run gateway, ML service and web concurrently"
	@echo "  make test      Smoke-test the compiled C++ engine"
	@echo "  make clean     Remove all build artifacts"

install:
	@echo "→ Node gateway deps"; cd $(GATEWAY_DIR) && npm install
	@echo "→ Python ML deps"; cd $(ML_DIR) && $(PYTHON) -m venv .venv && \
		./$(VENV_PY) -m pip install --upgrade pip && \
		./$(VENV_PY) -m pip install -r requirements.txt
	@echo "→ Next.js deps";      cd $(WEB_DIR) && npm install

engine:
	@echo "→ Building C++ mandi router ($(BUILD_TYPE))"
	cmake -S $(ENGINE_DIR) -B $(ENGINE_DIR)/build -DCMAKE_BUILD_TYPE=$(BUILD_TYPE)
	cmake --build $(ENGINE_DIR)/build --config $(BUILD_TYPE) -j$(shell nproc 2>/dev/null || echo 2)
	@echo "✓ Binary: $(ENGINE_DIR)/build/mandi_router"

gateway:
	cd $(GATEWAY_DIR) && npm run build

web:
	cd $(WEB_DIR) && npm run build

train:
	cd $(ML_DIR) && ./$(VENV_PY) -m app.models.train_svm_mock --samples 240
	cd $(ML_DIR) && ./$(VENV_PY) -m app.scripts.ingest

ml:
	cd $(ML_DIR) && ./$(VENV_PY) -m uvicorn app.main:app --host 0.0.0.0 --port $${ML_SERVICE_PORT:-8000} --reload

build: engine gateway web

test: verify-engine

verify-engine:
	@echo '{"volumeQuintals":40,"origin":{"lat":26.8467,"lon":80.9462},"vehicle":{"kmpl":8,"fuelPricePerLitre":94.5,"capacityQuintals":40},"localPricePerQuintal":1980,"mandis":[{"id":"m1","name":"Sitapur APMC","lat":27.5679,"lon":80.6828,"pricePerQuintal":2210,"handlingFee":150},{"id":"m2","name":"Lucknow APMC","lat":26.8467,"lon":80.9462,"pricePerQuintal":2090,"handlingFee":120},{"id":"m3","name":"Kanpur Grain","lat":26.4499,"lon":80.3319,"pricePerQuintal":2265,"handlingFee":260,"commissionPct":1.5}]}' \
		| $(ENGINE_DIR)/build/mandi_router

dev:
	@trap 'kill 0' EXIT; \
	( cd $(GATEWAY_DIR) && npm run dev ) & \
	( cd $(ML_DIR) && ./$(VENV_PY) -m uvicorn app.main:app --port $${ML_SERVICE_PORT:-8000} --reload ) & \
	( cd $(WEB_DIR) && npm run dev ) & \
	wait

clean:
	rm -rf $(ENGINE_DIR)/build
	rm -rf $(GATEWAY_DIR)/dist $(GATEWAY_DIR)/node_modules
	rm -rf $(WEB_DIR)/.next $(WEB_DIR)/node_modules $(WEB_DIR)/public/sw.js $(WEB_DIR)/public/workbox-*.js
	rm -rf $(ML_DIR)/.venv $(ML_DIR)/app/models/artifacts
	@echo "✓ cleaned"

ingest:
	cd $(ML_DIR) && ./$(VENV_PY) -m app.scripts.ingest

ingest-pdf:
	cd $(ML_DIR) && ./$(VENV_PY) -m app.scripts.ingest --pdf-dir data/scheme_pdfs