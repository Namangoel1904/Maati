"""Fine-tune Maati's chat examples with Tinker's hosted LoRA training API.

Install with: pip install tinker tinker-cookbook python-dotenv
Set TINKER_API_KEY in the environment (or a .env file) before running.
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

import tinker
from tinker_cookbook.renderers import TrainOnWhat, get_renderer
from tinker_cookbook.supervised.data import conversation_to_datum


DATASET_PATH = Path(__file__).with_name("dataset.jsonl")
# Tinker's current quickstart uses Qwen3.5-4B. Override this with any model
# currently enabled for your Tinker account, e.g. TINKER_BASE_MODEL.
BASE_MODEL = os.getenv("TINKER_BASE_MODEL", "Qwen/Qwen3.5-4B")
RENDERER_NAME = os.getenv("TINKER_RENDERER", "qwen3_5")
EPOCHS = int(os.getenv("TINKER_EPOCHS", "4"))
BATCH_SIZE = int(os.getenv("TINKER_BATCH_SIZE", "2"))
LORA_RANK = int(os.getenv("TINKER_LORA_RANK", "16"))
LEARNING_RATE = float(os.getenv("TINKER_LEARNING_RATE", "0.0001"))
MAX_LENGTH = int(os.getenv("TINKER_MAX_LENGTH", "2048"))
SAVE_NAME = os.getenv("TINKER_SAVE_NAME", "maati-gemma4-sft")
RANDOM_SEED = 42


def load_conversations(path: Path) -> list[list[dict[str, str]]]:
    if not path.is_file():
        raise FileNotFoundError(f"Training dataset not found: {path}")

    conversations: list[list[dict[str, str]]] = []
    with path.open("r", encoding="utf-8") as dataset_file:
        for line_number, line in enumerate(dataset_file, start=1):
            if not line.strip():
                continue
            try:
                row: Any = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on {path}:{line_number}: {exc}") from exc

            messages = row.get("messages") if isinstance(row, dict) else None
            if not isinstance(messages, list) or len(messages) < 2:
                raise ValueError(f"Expected a non-empty 'messages' conversation on {path}:{line_number}")
            for message in messages:
                if (not isinstance(message, dict)
                        or message.get("role") not in {"system", "user", "assistant"}
                        or not isinstance(message.get("content"), str)):
                    raise ValueError(f"Invalid chat message on {path}:{line_number}")
            if messages[-1]["role"] != "assistant":
                raise ValueError(f"Conversation must end with an assistant message on {path}:{line_number}")
            conversations.append(messages)

    if not conversations:
        raise ValueError(f"No training conversations found in {path}")
    return conversations


def main() -> None:
    if not os.getenv("TINKER_API_KEY"):
        raise RuntimeError("TINKER_API_KEY is required (set it in the environment or a .env file)")
    if not 3 <= EPOCHS <= 5:
        raise ValueError("TINKER_EPOCHS must be between 3 and 5")
    if BATCH_SIZE < 1 or LORA_RANK < 1 or MAX_LENGTH < 32 or LEARNING_RATE <= 0:
        raise ValueError("Batch size, LoRA rank, max length, and learning rate must be positive")

    conversations = load_conversations(DATASET_PATH)
    service_client = tinker.ServiceClient()
    training_client = service_client.create_lora_training_client(
        base_model=BASE_MODEL,
        rank=LORA_RANK,
        user_metadata={"project": "maati", "dataset": DATASET_PATH.name},
    )

    tokenizer = training_client.get_tokenizer()
    renderer = get_renderer(RENDERER_NAME, tokenizer)
    training_data = [
        conversation_to_datum(
            conversation,
            renderer,
            max_length=MAX_LENGTH,
            train_on_what=TrainOnWhat.LAST_ASSISTANT_MESSAGE,
        )
        for conversation in conversations
    ]

    optimizer = tinker.AdamParams(learning_rate=LEARNING_RATE)
    rng = random.Random(RANDOM_SEED)
    step = 0
    print(f"Training {len(training_data)} examples on {BASE_MODEL} for {EPOCHS} epochs")

    for epoch in range(EPOCHS):
        order = list(range(len(training_data)))
        rng.shuffle(order)
        for start in range(0, len(order), BATCH_SIZE):
            batch = [training_data[index] for index in order[start:start + BATCH_SIZE]]
            forward_future = training_client.forward_backward(batch, loss_fn="cross_entropy")
            optimizer_future = training_client.optim_step(optimizer)
            forward_future.result()
            optimizer_future.result()
            step += 1
        print(f"Completed epoch {epoch + 1}/{EPOCHS} ({step} optimizer steps)")

    # Persist a sampler checkpoint so Backboard can reference the returned tinker:// path.
    saved = training_client.save_weights_for_sampler(name=SAVE_NAME).result()
    if not saved.path:
        raise RuntimeError("Tinker completed training but returned no sampler checkpoint path")
    print(f"model_path={saved.path}")


if __name__ == "__main__":
    main()
