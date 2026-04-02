import csv

input_file = 'pokemon_moves.csv'
output_file = 'ordered_pokemon_moves.csv'

# Dictionary to keep track of the running count for each unique Pokémon
pokemon_counts = {}

with open(input_file, mode='r', encoding='utf-8') as infile, \
     open(output_file, mode='w', newline='', encoding='utf-8') as outfile:

    reader = csv.DictReader(infile)
    
    # Add our new 'display_order' column to the end of the headers
    fieldnames = reader.fieldnames + ['display_order']
    writer = csv.DictWriter(outfile, fieldnames=fieldnames)
    
    writer.writeheader()

    for row in reader:
        # Use a tuple of (pokedex_id, form) to uniquely identify the Pokémon
        poke_id = (row['pokedex_id'], row['form'])
        
        # Initialize at 0 if not seen yet, then add 1
        pokemon_counts[poke_id] = pokemon_counts.get(poke_id, 0) + 1
        
        # Assign the count to the new column
        row['display_order'] = pokemon_counts[poke_id]
        
        writer.writerow(row)

print(f"Success! Ordered CSV saved to {output_file}")
