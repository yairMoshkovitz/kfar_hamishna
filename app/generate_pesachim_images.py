import json
import mimetypes
import os
import time
from pathlib import Path
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Set up SOCKS5 proxy
os.environ["HTTP_PROXY"] = "socks5h://127.0.0.1:1080"
os.environ["HTTPS_PROXY"] = "socks5h://127.0.0.1:1080"

# Configurations
SCENES_JSON_PATH = Path(r"C:\Users\MyPC\Downloads\pesachim_scenes.json")
CHARACTERS_DIR = Path(r"C:\Users\MyPC\Desktop\code\kfar_hamishna\data\images\charcter_v2")
OUTPUT_DIR = Path(r"C:\Users\MyPC\Desktop\code\kfar_hamishna\data\images\pesachim_v1")

# Default style reference image (Optional)
# This will be used as a reference if no previous scene exists, to maintain a consistent style.
DEFAULT_STYLE_REF = Path(r"C:\Users\MyPC\Desktop\code\kfar_hamishna\data\images\style.jpg")

MODEL = "gemini-3.1-flash-image"

def save_binary_file(file_name, data):
    with open(file_name, "wb") as f:
        f.write(data)
    print(f"File saved to: {file_name}")

def guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "image/jpeg"

def create_image_part(image_path: Path):
    if not image_path.exists():
        print(f"Warning: Image not found at {image_path}")
        return None
    return types.Part.from_bytes(
        data=image_path.read_bytes(),
        mime_type=guess_mime(image_path)
    )

def generate_scene_image(client, prompt: str, reference_paths: list[Path], output_path: Path, scene_type: str = "character"):
    print(f"\n[Gemini] Starting image generation for: {output_path.name} (type: {scene_type})")
    print(f"[Gemini] References: {[p.name for p in reference_paths if p and p.exists()]}")
    
    parts = []
    
    # Add reference images first
    for rp in reference_paths:
        if rp and rp.exists():
            part = create_image_part(rp)
            if part:
                parts.append(part)
                
    # Add the text prompt
    if scene_type == "object":
        instruction = (
            "Use the provided reference images ONLY to keep the artistic style consistent. "
            "Focus strictly on the main object. Keep the background simple, clean and uncluttered "
            "as this element will be integrated into other scenes. Do NOT include any characters. "
            "Generate a single illustration for the following object: " + prompt
        )
    elif scene_type == "place":
        instruction = (
            "Use the provided reference images ONLY to keep the artistic style consistent. "
            "Focus on the environment and atmosphere. Do NOT include any characters unless "
            "explicitly mentioned in the prompt. Generate a single illustration for the following place: " + prompt
        )
    else: # character
        instruction = prompt
        if reference_paths:
            instruction = (
                "Use the provided reference images to keep the characters' appearance and the scene's style "
                "consistent. Generate a single illustration for the following scene: " + prompt
            )
    
    parts.append(types.Part.from_text(text=instruction))
    
    contents = [
        types.Content(
            role="user",
            parts=parts,
        ),
    ]
    
    generate_content_config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_level="MINIMAL",
        ),
        image_config = types.ImageConfig(
            aspect_ratio="16:9",
            image_size="1K",
        ),
        response_modalities=[
            "IMAGE",
            "TEXT",
        ],
    )
    
    print(f"[Gemini] Sending request to API...")
    try:
        for chunk in client.models.generate_content_stream(
            model=MODEL,
            contents=contents,
            config=generate_content_config,
        ):
            if chunk.parts is None:
                continue
            if chunk.parts[0].inline_data and chunk.parts[0].inline_data.data:
                inline_data = chunk.parts[0].inline_data
                data_buffer = inline_data.data
                save_binary_file(str(output_path), data_buffer)
                return output_path
            else:
                if text := chunk.text:
                    print(f"[Gemini Text Output]: {text}")
                    
        print(f"[Gemini ERROR] No image data found in response stream.")
    except Exception as e:
        print(f"[Gemini ERROR] API call failed: {type(e).__name__}: {e}")
        
    return None

def main():
    load_dotenv()
    if not os.environ.get("GEMINI_API_KEY"):
        print("Error: GEMINI_API_KEY environment variable is not set.")
        return

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(SCENES_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    scenes = data.get("scenes", [])
    print(f"Loaded {len(scenes)} scenes.")
    
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    
    previous_image_path = None
    
    for i, scene in enumerate(scenes):
        scene_num = scene.get("scene_number", i + 1)
        prompt = scene.get("image_prompt", "").lower()
        characters_present = scene.get("characters_present", [])
        
        # Determine scene type
        scene_type = "character"
        if not characters_present:
            # Check if it's an object or a place
            place_keywords = ["מחסן", "בית", "חדר", "שוק", "רחוב", "warehouse", "room", "market", "street", "house", "מטבח", "kitchen", "חצר", "yard"]
            if any(kw in prompt for kw in place_keywords):
                scene_type = "place"
            else:
                scene_type = "object"
        
        output_filename = f"scene_{scene_num:02d}.jpg"
        output_path = OUTPUT_DIR / output_filename
        
        if output_path.exists():
             print(f"Skipping {output_filename}, already exists.")
             previous_image_path = output_path
             continue
             
        reference_paths = []
        
        # 1. Add style reference (Previous scene OR Default style)
        if previous_image_path and previous_image_path.exists():
            reference_paths.append(previous_image_path)
        elif DEFAULT_STYLE_REF and DEFAULT_STYLE_REF.exists():
            print(f"Using default style reference: {DEFAULT_STYLE_REF.name}")
            reference_paths.append(DEFAULT_STYLE_REF)
            
        # 2. Add character images ONLY if characters are present
        if scene_type == "character":
            for char_name in characters_present:
                char_path = CHARACTERS_DIR / f"{char_name}.jpg"
                if char_path.exists():
                    reference_paths.append(char_path)
                else:
                    print(f"Warning: Character image not found for {char_name}")
                
        # Generate the image
        result_path = generate_scene_image(client, prompt, reference_paths, output_path, scene_type=scene_type)
        
        if result_path:
            previous_image_path = result_path
        else:
            print(f"Failed to generate image for scene {scene_num}. Will try to continue without it.")
            
        # Sleep slightly to avoid rate limits
        time.sleep(2)

if __name__ == "__main__":
    main()
