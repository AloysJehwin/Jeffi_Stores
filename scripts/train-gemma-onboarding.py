#!/usr/bin/env python
"""
LoRA fine-tune Gemma 3 270M for the on-device checkout recap.

Run on razer-gpu:
    cd ~/sd-cover
    .venv/bin/python train-gemma-onboarding.py

Reads train.jsonl / val.jsonl ({"prompt","completion"}) in the CWD, LoRA
fine-tunes google/gemma-3-270m, merges the adapter, and writes the merged model
to ~/sd-cover/gemma-onboarding-merged/ for ONNX export.

Needs a HF token with Gemma access if the model is gated:
    export HF_TOKEN=hf_xxx   (or huggingface-cli login)
"""
import json, os, sys
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig

BASE = os.environ.get("GEMMA_BASE", "google/gemma-3-270m")
OUT = os.path.expanduser("~/sd-cover/gemma-onboarding")
MERGED = os.path.expanduser("~/sd-cover/gemma-onboarding-merged")
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

def main():
    tok = AutoTokenizer.from_pretrained(BASE, token=HF_TOKEN)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        BASE, torch_dtype=torch.bfloat16, device_map="cuda", token=HF_TOKEN,
    )

    # Build a single "text" field: prompt + completion + EOS.
    def fmt(ex):
        return {"text": ex["prompt"] + ex["completion"] + tok.eos_token}

    ds_train = load_dataset("json", data_files="train.jsonl", split="train").map(fmt)
    ds_val = load_dataset("json", data_files="val.jsonl", split="train").map(fmt)

    lora = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )

    cfg = SFTConfig(
        output_dir=OUT,
        num_train_epochs=3,
        per_device_train_batch_size=8,
        gradient_accumulation_steps=2,
        learning_rate=2e-4,
        logging_steps=20,
        eval_strategy="epoch",
        save_strategy="epoch",
        bf16=True,
        max_length=768,
        packing=False,
        report_to=[],
        dataset_text_field="text",
    )

    trainer = SFTTrainer(
        model=model, args=cfg, peft_config=lora,
        train_dataset=ds_train, eval_dataset=ds_val,
    )
    trainer.train()

    # Merge LoRA into the base weights for a clean ONNX export.
    print("Merging adapter…")
    merged = trainer.model.merge_and_unload()
    merged.save_pretrained(MERGED)
    tok.save_pretrained(MERGED)
    print("MERGED_SAVED", MERGED)

if __name__ == "__main__":
    main()
