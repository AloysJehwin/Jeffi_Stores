#!/usr/bin/env python3
"""
Razer image server: an Automatic1111-compatible subset over diffusers + SDXL-Turbo, for the
AI gateway's `razer` image provider (SD_WEBUI_URL).

  POST /sdapi/v1/txt2img   POST /sdapi/v1/img2img   GET /sdapi/v1/options   GET /health

Weights stay in RAM; model CPU offload moves each part onto the GPU only while drawing, so the
card is shared with Ollama (the GPU guard treats this service as one of its own).
Turbo is distilled for 1-4 steps at guidance 0, so the gateway's steps/cfg are mapped onto that.
"""
import base64, io, math, os, random, threading

import torch
from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

MODEL = os.environ.get("SD_SERVER_MODEL", "stabilityai/sdxl-turbo")
MAX_SIDE = int(os.environ.get("SD_SERVER_MAX_SIDE", "1024"))
MAX_BATCH = int(os.environ.get("SD_SERVER_MAX_BATCH", "4"))

txt2img = AutoPipelineForText2Image.from_pretrained(MODEL, torch_dtype=torch.float16, variant="fp16")
txt2img.enable_model_cpu_offload()
# diffusers >= 0.40 moved tiling onto the VAE.
if hasattr(txt2img, "enable_vae_tiling"):
    txt2img.enable_vae_tiling()
else:
    txt2img.vae.enable_tiling()
img2img = AutoPipelineForImage2Image.from_pipe(txt2img)
lock = threading.Lock()
app = FastAPI()


class Req(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 512
    height: int = 512
    batch_size: int = 1
    steps: int = 4
    cfg_scale: float = 0.0
    seed: int = -1
    init_images: list[str] | None = None
    denoising_strength: float = 0.6


def fit(w: int, h: int) -> tuple[int, int]:
    """Largest multiple-of-8 size within MAX_SIDE that keeps the aspect ratio."""
    s = min(1.0, MAX_SIDE / max(w, h))
    return max(256, int(w * s) // 8 * 8), max(256, int(h * s) // 8 * 8)


def turbo_steps(requested: int) -> int:
    # The gateway asks for ~12 (draft) or ~25 (standard/premium) A1111 steps.
    return 2 if requested <= 12 else 4


def encode(img: Image.Image, w: int, h: int) -> str:
    if img.size != (w, h):
        img = img.resize((w, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def run(req: Req, init: Image.Image | None) -> dict:
    n = max(1, min(MAX_BATCH, req.batch_size))
    gw, gh = fit(req.width, req.height)
    seed = req.seed if req.seed >= 0 else random.randint(0, 2**31 - 1)
    gen = torch.Generator("cpu").manual_seed(seed)
    steps = turbo_steps(req.steps)
    with lock:
        try:
            if init is None:
                out = txt2img(prompt=req.prompt, negative_prompt=req.negative_prompt or None,
                              width=gw, height=gh, num_inference_steps=steps, guidance_scale=0.0,
                              num_images_per_prompt=n, generator=gen).images
            else:
                strength = min(1.0, max(0.1, req.denoising_strength))
                out = img2img(prompt=req.prompt, image=init.convert("RGB").resize((gw, gh)),
                              strength=strength, num_inference_steps=max(steps, math.ceil(1 / strength)),
                              guidance_scale=0.0, num_images_per_prompt=n, generator=gen).images
        except torch.cuda.OutOfMemoryError:
            raise HTTPException(503, "GPU out of memory")
        finally:
            torch.cuda.empty_cache()
    return {"images": [encode(i, req.width, req.height) for i in out], "info": f'{{"seed": {seed}}}', "parameters": {}}


@app.post("/sdapi/v1/txt2img")
def t2i(req: Req):
    return run(req, None)


@app.post("/sdapi/v1/img2img")
def i2i(req: Req):
    if not req.init_images:
        raise HTTPException(400, "init_images required")
    raw = req.init_images[0].split(",", 1)[-1]
    return run(req, Image.open(io.BytesIO(base64.b64decode(raw))))


@app.get("/sdapi/v1/options")
def options():
    return {"sd_model_checkpoint": MODEL.split("/")[-1]}


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}
