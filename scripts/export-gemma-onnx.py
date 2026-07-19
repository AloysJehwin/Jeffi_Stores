#!/usr/bin/env python
"""
Export the fine-tuned recap model to ONNX (quantized) for transformers.js.

Run on razer-gpu:
    cd ~/sd-cover
    .venv/bin/python export-gemma-onnx.py

Produces ~/sd-cover/gemma-onboarding-onnx/ in the transformers.js layout:
    config.json, tokenizer.json, tokenizer_config.json,
    onnx/model.onnx (+ external data) and onnx/model_q4.onnx (quantized)
"""
import os, subprocess, sys, shutil

SRC = os.path.expanduser("~/sd-cover/gemma-onboarding-merged")
OUT = os.path.expanduser("~/sd-cover/gemma-onboarding-onnx")

def run(cmd):
    print("+", " ".join(cmd)); sys.stdout.flush()
    subprocess.check_call(cmd)

def main():
    os.makedirs(OUT, exist_ok=True)
    # 1) Export to ONNX via optimum (text-generation-with-past for KV cache).
    run([
        sys.executable, "-m", "optimum.exporters.onnx",
        "--model", SRC,
        "--task", "text-generation-with-past",
        OUT,
    ])
    # 2) Quantize to int8/q4 for a small browser download.
    #    transformers.js looks for onnx/model_quantized.onnx when dtype:'q8'/'q4'.
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        onnx_dir = os.path.join(OUT, "onnx") if os.path.isdir(os.path.join(OUT, "onnx")) else OUT
        src_onnx = None
        for f in os.listdir(onnx_dir):
            if f.endswith("model.onnx") or f == "model.onnx":
                src_onnx = os.path.join(onnx_dir, f); break
        if src_onnx:
            q_out = os.path.join(onnx_dir, "model_quantized.onnx")
            quantize_dynamic(src_onnx, q_out, weight_type=QuantType.QInt8)
            print("QUANTIZED", q_out)
        else:
            print("WARN: no model.onnx found to quantize in", onnx_dir)
    except Exception as e:
        print("WARN quantize failed:", type(e).__name__, str(e)[:200])

    print("EXPORT_DONE", OUT)

if __name__ == "__main__":
    main()
