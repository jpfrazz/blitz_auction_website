import os
from PIL import Image

current_dir = os.path.dirname(os.path.abspath(__file__))
processed_count = 0

print("Starting aggressive trim...")

for filename in os.listdir(current_dir):
    if filename.lower().endswith('.png') and filename != 'crop_pokemon.py':
        file_path = os.path.join(current_dir, filename)
        
        try:
            with Image.open(file_path) as img:
                # Convert to RGBA just in case the image is indexed/palette based
                img = img.convert("RGBA")
                
                # Split into R, G, B, and Alpha channels
                r, g, b, a = img.split()
                
                # getbbox() on the Alpha channel finds ONLY pixels that are not transparent
                bbox = a.getbbox()
                
                if bbox:
                    # Crop the original image using the alpha channel's bounding box
                    cropped_img = img.crop(bbox)
                    cropped_img.save(file_path)
                    processed_count += 1
                else:
                    print(f"Skipped {filename} (completely transparent)")
                    
        except Exception as e:
            print(f"Error processing {filename}: {e}")

print(f"\nFinished! Successfully cropped {processed_count} images.")