# Génère renderer/emoji-data.js à partir de la base Unicode de Python (hors ligne)
import sys, json, re, unicodedata as ud
from collections import Counter

out_path = sys.argv[1]

def rng(spec):
    out = []
    for tok in spec.split():
        if '-' in tok:
            a, b = tok.split('-'); out += list(range(int(a, 16), int(b, 16) + 1))
        else:
            out.append(int(tok, 16))
    return out

BMP = rng("""203C 2049 2122 2139 2194-2199 21A9 21AA 231A 231B 2328 23CF 23E9-23F3 23F8-23FA 24C2 25AA 25AB 25B6 25C0 25FB-25FE
2600-2604 260E 2611 2614 2615 2618 261D 2620 2622 2623 2626 262A 262E 262F 2638-263A 2640 2642 2648-2653 265F 2660 2663
2665 2666 2668 267B 267E 267F 2692-2697 2699 269B 269C 26A0 26A1 26A7 26AA 26AB 26B0 26B1 26BD 26BE 26C4 26C5 26C8 26CE
26CF 26D1 26D3 26D4 26E9 26EA 26F0-26F5 26F7-26FA 26FD 2702 2705 2708-270D 270F 2712 2714 2716 271D 2721 2728 2733 2734
2744 2747 274C 274E 2753-2755 2757 2763 2764 2795-2797 27A1 27B0 27BF 2934 2935 2B05-2B07 2B1B 2B1C 2B50 2B55 3030 303D
3297 3299 1F004 1F0CF 1F170 1F171 1F17E 1F17F 1F18E 1F191-1F19A 1F201 1F202 1F21A 1F22F 1F232-1F23A 1F250 1F251""")
SMP = rng("1F300-1F3FA 1F400-1F64F 1F680-1F6FF 1F7E0-1F7F0 1F90C-1F9FF 1FA70-1FAFF")
SKIP = set(rng("""1F3FB-1F3FF 1F322 1F323 1F394 1F395 1F398 1F39C 1F39D 1F3F1 1F3F2 1F3F6 1F4FE 1F53E-1F548 1F54F 1F568-1F56E
1F571 1F572 1F57B-1F586 1F588 1F589 1F58E 1F58F 1F591-1F594 1F597-1F5A3 1F5A6 1F5A7 1F5A9-1F5B0 1F5B3-1F5BB 1F5BD-1F5C1
1F5C5-1F5D0 1F5D4-1F5DB 1F5DF 1F5E0 1F5E2 1F5E4-1F5E7 1F5E9-1F5EE 1F5F0-1F5F2 1F5F4-1F5F9 1F6C6-1F6CA 1F6D3 1F6D4
1F6E6-1F6E8 1F6EA 1F6F1 1F6F2 1F93B 1F946"""))
# Emojis affichés en texte par défaut : on ajoute le sélecteur de variante 16
TEXT_DEFAULT = set(rng("""1F321 1F324-1F32C 1F336 1F37D 1F396 1F397 1F399-1F39B 1F39E 1F39F 1F3CB-1F3CE 1F3D4-1F3DF 1F3F3 1F3F5
1F3F7 1F43F 1F441 1F4FD 1F549 1F54A 1F56F 1F570 1F573-1F579 1F587 1F58A-1F58D 1F590 1F5A5 1F5A8 1F5B1 1F5B2 1F5BC
1F5C2-1F5C4 1F5D1-1F5D3 1F5DC-1F5DE 1F5E1 1F5E3 1F5E8 1F5EF 1F5F3 1F5FA 1F6CB 1F6CD-1F6CF 1F6E0-1F6E5 1F6E9 1F6F0 1F6F3
1F170 1F171 1F17E 1F17F 1F202 1F237"""))

ZWJ = ['👨‍💻', '👩‍💻', '🧑‍💻', '🧑‍🔬', '🧑‍🔧', '🧑‍🏭', '🧑‍🚀', '🧑‍🏫', '🧑‍🎨', '🧑‍⚕️', '🧑‍🍳', '🧑‍🚒', '🧑‍✈️', '🧑‍⚖️', '🧑‍🌾',
       '🕵️‍♂️', '🦸‍♂️', '🦹‍♀️', '🧙‍♂️', '🧚‍♀️', '🧛‍♂️', '🧜‍♀️', '🧝‍♂️', '🧞‍♂️', '🧟‍♂️', '🏃‍♂️', '🚴‍♀️',
       '👁️‍🗨️', '❤️‍🔥', '❤️‍🩹', '😶‍🌫️', '😮‍💨', '😵‍💫', '🐻‍❄️', '🐕‍🦺', '🐈‍⬛', '🐦‍⬛', '🐦‍🔥', '🍋‍🟩', '🍄‍🟫',
       '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '⛓️‍💥', '🙂‍↔️', '🙂‍↕️']

GROUPS = [
    ('smileys', 'Smileys et émotions', '😀'),
    ('people', 'Personnes et corps', '👋'),
    ('animals', 'Animaux et nature', '🐻'),
    ('food', 'Nourriture et boissons', '🍔'),
    ('travel', 'Voyages et lieux', '🚀'),
    ('activities', 'Activités', '⚽'),
    ('objects', 'Objets', '💡'),
    ('symbols', 'Symboles', '🔣'),
]
G = {k: i for i, (k, _, _) in enumerate(GROUPS)}

def words(*s): return set(' '.join(s).split())
SMILEY = words('FACE GRINNING SMILING HEART KISS ANGER COLLISION DIZZY SWEAT SPEECH THOUGHT ZZZ HUNDRED HOLE BOMB',
               'SKULL GHOST ALIEN ROBOT OGRE GOBLIN CLOWN PILE POO SEE-NO-EVIL HEAR-NO-EVIL SPEAK-NO-EVIL DROPLETS')
PEOPLE = words('HAND HANDS FINGER FINGERS FIST PERSON PEOPLE MAN WOMAN MEN WOMEN BOY GIRL BABY CHILD ADULT OLDER EYE EYES EAR',
               'NOSE MOUTH LIPS TONGUE LEG FOOT BRAIN TOOTH BONE BICEPS PRINCESS PRINCE ANGEL FAIRY MERPERSON MERMAID MERMAN',
               'ZOMBIE GENIE VAMPIRE MAGE ELF NINJA FAMILY COUPLE FOOTPRINTS BUST BUSTS DETECTIVE GUARDSMAN WORKER',
               'SANTA CLAUS SUPERHERO SUPERVILLAIN TROLL PREGNANT BREAST-FEEDING LUNGS ANATOMICAL THUMBS HORNS WAVING CLAPPING',
               'RAISED SELFIE NAIL WRITING BOWING HEADSCARF TURBAN TUXEDO VEIL GESTURING OFFICER DANCER DANCING',
               'NAMASTE PINCHED PINCHING HANDSHAKE BEARD BALD HAIR FINGERPRINT SURFER SWIMMER JUGGLING CARTWHEEL WRESTLERS',
               'MASSAGE HAIRCUT POUTING FROWNING STANDING KNEELING DEAF SPEAKING')
ANIMALS = words('DOG CAT MOUSE RAT HAMSTER RABBIT FOX BEAR PANDA KOALA TIGER LION COW PIG BOAR FROG MONKEY CHICKEN PENGUIN BIRD',
                'CHICK HATCHING DUCK EAGLE OWL BAT WOLF HORSE UNICORN BEE HONEYBEE BUG BUTTERFLY SNAIL BEETLE ANT TURTLE SNAKE',
                'LIZARD SAUROPOD T-REX OCTOPUS SQUID LOBSTER CRAB FISH DOLPHIN WHALE SHARK CROCODILE LEOPARD ZEBRA GORILLA',
                'ORANGUTAN ELEPHANT MAMMOTH HIPPOPOTAMUS RHINOCEROS CAMEL GIRAFFE KANGAROO BUFFALO OX RAM SHEEP GOAT DEER LLAMA',
                'POODLE ROOSTER TURKEY DODO PEACOCK PARROT SWAN FLAMINGO DOVE RACCOON SKUNK BADGER BEAVER OTTER SLOTH HEDGEHOG',
                'CHIPMUNK DRAGON SPIDER SCORPION MOSQUITO FLY WORM MICROBE CRICKET COCKROACH SEAL JELLYFISH CORAL MOOSE DONKEY GOOSE',
                'WING FEATHER PAW BLOWFISH SPOUTING PLANT FLOWER BLOSSOM ROSE TULIP SUNFLOWER HIBISCUS HYACINTH LOTUS',
                'BOUQUET SEEDLING TREE EVERGREEN DECIDUOUS CACTUS HERB SHAMROCK CLOVER LEAF LEAVES MAPLE FALLEN MUSHROOM NEST',
                'ROCK WOOD SHELL WILTED POTTED SHEAF FUNGUS ORCA LEAFLESS ROOT POODLE SERVICE')
FOOD = words('GRAPES MELON WATERMELON TANGERINE LEMON BANANA PINEAPPLE MANGO APPLE PEAR PEACH CHERRIES STRAWBERRY BLUEBERRIES',
             'KIWIFRUIT TOMATO OLIVE COCONUT AVOCADO AUBERGINE EGGPLANT POTATO CARROT CORN PEPPER CUCUMBER BROCCOLI GARLIC ONION',
             'PEANUTS BEANS CHESTNUT GINGER PEA BREAD CROISSANT BAGUETTE FLATBREAD PRETZEL BAGEL PANCAKES WAFFLE CHEESE MEAT POULTRY',
             'BEVERAGE LEAFY TOFU MOONCAKE BACON HAMBURGER FRIES PIZZA TACO BURRITO TAMALE SANDWICH FALAFEL EGG COOKING SHALLOW',
             'FONDUE SALAD POPCORN BUTTER SALT CANNED BENTO CRACKER RICE CURRY RAMEN STEAMING SPAGHETTI ROASTED SUSHI ODEN DANGO',
             'DUMPLING FORTUNE TAKEOUT SHAVED DOUGHNUT COOKIE BIRTHDAY CAKE SHORTCAKE CUPCAKE PIE CHOCOLATE CANDY LOLLIPOP',
             'CUSTARD HONEY MILK TEAPOT TEACUP SAKE WINE COCKTAIL BEER MUGS CLINKING TUMBLER POURING MATE CHOPSTICKS FORK SPOON',
             'AMPHORA JAR')
ACTIV = words('JACK-O-LANTERN FIREWORKS FIREWORK SPARKLER FIRECRACKER PARTY CONFETTI TANABATA STREAMER RIBBON WRAPPED GIFT',
              'REMINDER ADMISSION TICKETS TICKET MEDAL TROPHY SPORTS FIRST SECOND THIRD SOCCER BASEBALL SOFTBALL BASKETBALL',
              'VOLLEYBALL AMERICAN RUGBY TENNIS FLYING DISC BOWLING FIELD HOCKEY LACROSSE PING PONG BADMINTON BOXING GLOVE MARTIAL',
              'GOAL GOLF SKATE FISHING DIVING RUNNING SKI SLED CURLING DIRECT HIT YO-YO KITE BILLIARDS CRYSTAL MAGIC WAND VIDEO GAME',
              'JOYSTICK SLOT PUZZLE TEDDY PINATA NESTING CHESS PAWN JOKER MAHJONG PERFORMING ARTS FRAMED ARTIST PALETTE THREAD',
              'SEWING NEEDLE YARN KNOT DART DICE BOOMERANG MIRROR BALLOON SPARKLES')
TRAVEL = words('GLOBE WORLD MAP MOUNTAIN VOLCANO CAMPING BEACH DESERT ISLAND NATIONAL PARK STADIUM BUILDING CONSTRUCTION BRICK',
               'HOUSE HOUSES HUT OFFICE HOSPITAL BANK HOTEL CONVENIENCE SCHOOL DEPARTMENT FACTORY CASTLE WEDDING TOWER',
               'STATUE CHURCH MOSQUE TEMPLE SYNAGOGUE SHINTO KAABA FOUNTAIN TENT FOGGY NIGHT CITYSCAPE SUNRISE SUNSET BRIDGE SPRINGS',
               'CAROUSEL PLAYGROUND FERRIS ROLLER BARBER CIRCUS LOCOMOTIVE RAILWAY TRAIN METRO STATION TRAM MONORAIL BUS TROLLEYBUS',
               'MINIBUS AMBULANCE ENGINE TAXI AUTOMOBILE CAR VEHICLE TRUCK LORRY TRACTOR RACING MOTORCYCLE SCOOTER WHEELCHAIR',
               'BICYCLE SKATEBOARD MOTORWAY FUEL TYRE ANCHOR BUOY SAILBOAT CANOE SPEEDBOAT SHIP FERRY BOAT AIRPLANE PARACHUTE',
               'HELICOPTER SUSPENSION CABLEWAY AERIAL TRAMWAY SATELLITE ROCKET SAUCER BELLHOP HOURGLASS WATCH ALARM CLOCK STOPWATCH',
               'TIMER MANTELPIECE SUN MOON STAR STARS GLOWING SHOOTING MILKY CLOUD CLOUDS THERMOMETER RAIN SNOW LIGHTNING TORNADO FOG',
               'WIND CYCLONE RAINBOW UMBRELLA VOLTAGE SNOWFLAKE SNOWMAN COMET FIRE DROPLET WAVE RINGED PLANET CRESCENT FLAG FLAGS',
               'MAILBOX POSTBOX')
OBJECTS = words('TELEPHONE SCISSORS ENVELOPE PENCIL NIB KEYBOARD HAMMER PICK SWORDS GEAR ALEMBIC SCALES COFFIN FUNERAL CHAINS',
                'HELMET STAFF DOOR BED COUCH SHOPPING TOILET SHOWER BATHTUB SHIELD WRENCH ELEVATOR WINDOW PLUNGER BUCKET')
OVERRIDE = {
    'HOT DOG': 'food', 'HOT SPRINGS': 'travel', 'FISH CAKE WITH SWIRL DESIGN': 'food', 'FRIED SHRIMP': 'food', 'SHRIMP': 'animals',
    'TROPICAL DRINK': 'food', 'CHRISTMAS TREE': 'activities', 'FISHING POLE AND FISH': 'activities', 'HORSE RACING': 'people',
    'CRICKET BAT AND BALL': 'activities', 'WATER POLO': 'people', 'TEDDY BEAR': 'activities', 'EAR OF MAIZE': 'food',
    'EAR OF RICE': 'animals', 'PALM TREE': 'animals', 'MEAT ON BONE': 'food', 'POULTRY LEG': 'food', 'BABY BOTTLE': 'food',
    'PINE DECORATION': 'activities', 'JAPANESE DOLLS': 'activities', 'CARP STREAMER': 'activities', 'MOON VIEWING CEREMONY': 'activities',
    'ICE HOCKEY STICK AND PUCK': 'activities', 'ICE SKATE': 'activities', 'PLAYING CARD BLACK JOKER': 'activities',
    'MAHJONG TILE RED DRAGON': 'activities', 'FLOWER PLAYING CARDS': 'activities', 'SNOWBOARDER': 'people', 'RUNNER': 'people',
    'GOLFER': 'people', 'WEIGHT LIFTER': 'people', 'SKIER': 'people', 'FOOTPRINTS': 'people', 'IMP': 'smileys',
    'POLICE CAR': 'travel', 'ONCOMING POLICE CAR': 'travel', 'POLICE CARS REVOLVING LIGHT': 'travel',
    'JAPANESE POST OFFICE': 'travel', 'EUROPEAN POST OFFICE': 'travel', 'JAPANESE CASTLE': 'travel',
    'JAPANESE OGRE': 'smileys', 'JAPANESE GOBLIN': 'smileys', 'HOCHO': 'food', 'BOWL WITH SPOON': 'food',
    'CUP WITH STRAW': 'food', 'BUBBLE TEA': 'food', 'ICE CUBE': 'food', 'BOTTLE WITH POPPING CORK': 'food', 'BEVERAGE BOX': 'food',
    'GLASS OF MILK': 'food', 'WINE GLASS': 'food', 'POT OF FOOD': 'food', 'HOT PEPPER': 'food', 'FORK AND KNIFE': 'food',
    'FORK AND KNIFE WITH PLATE': 'food', 'SOFT ICE CREAM': 'food', 'ICE CREAM': 'food', 'SHAVED ICE': 'food',
    'SPEECH BALLOON': 'smileys', 'CRYSTAL BALL': 'activities', 'GEM STONE': 'objects', 'MILITARY HELMET': 'objects',
    'MAN IN BUSINESS SUIT LEVITATING': 'people', 'BABY SYMBOL': 'symbols', 'MENS SYMBOL': 'symbols', 'WOMENS SYMBOL': 'symbols',
    'CHILDREN CROSSING': 'symbols', 'BLACK HEART SUIT': 'activities', 'BLACK SPADE SUIT': 'activities', 'BLACK CLUB SUIT': 'activities',
    'BLACK DIAMOND SUIT': 'activities', 'BLACK CHESS PAWN': 'activities', 'FLAG IN HOLE': 'activities',
    'SPEAKING HEAD IN SILHOUETTE': 'people', 'BUST IN SILHOUETTE': 'people', 'BUSTS IN SILHOUETTE': 'people',
    'EYEGLASSES': 'objects', 'DARK SUNGLASSES': 'objects', 'GRADUATION CAP': 'objects', 'TOP HAT': 'objects', 'CROWN': 'objects',
    'WOMANS HAT': 'objects', 'MANS SHOE': 'objects', 'WOMANS CLOTHES': 'objects', 'WOMANS BOOTS': 'objects', 'WOMANS SANDAL': 'objects',
    'HIGH-HEELED SHOE': 'objects', 'BILLED CAP': 'objects', 'LIPSTICK': 'objects', 'RING': 'objects', 'MAGNIFYING GLASS TILTED LEFT': 'objects',
    'LEFT-POINTING MAGNIFYING GLASS': 'objects', 'RIGHT-POINTING MAGNIFYING GLASS': 'objects', 'ELECTRIC LIGHT BULB': 'objects',
    'FIRE ENGINE': 'travel', 'FIRE EXTINGUISHER': 'objects', 'BATHTUB': 'objects', 'BATH': 'people', 'SLEEPING ACCOMMODATION': 'people',
    'PERSON IN BED': 'people', 'ROWBOAT': 'people', 'MOUNTAIN BICYCLIST': 'people', 'BICYCLIST': 'people', 'PEDESTRIAN': 'people',
    'HEART WITH ARROW': 'smileys', 'HEART HANDS': 'people', 'LOVE LETTER': 'smileys', 'KISS MARK': 'smileys', 'KISS': 'people',
    'DASH SYMBOL': 'smileys', 'SPLASHING SWEAT SYMBOL': 'smileys', 'DIZZY SYMBOL': 'smileys', 'ANGER SYMBOL': 'smileys',
    'SLEEPING SYMBOL': 'smileys', 'HUNDRED POINTS SYMBOL': 'smileys', 'COLLISION SYMBOL': 'smileys', 'MONEY BAG': 'objects',
    'BANKNOTE WITH DOLLAR SIGN': 'objects', 'BANKNOTE WITH YEN SIGN': 'objects', 'BANKNOTE WITH EURO SIGN': 'objects',
    'BANKNOTE WITH POUND SIGN': 'objects', 'CREDIT CARD': 'objects', 'HEAVY DOLLAR SIGN': 'symbols', 'CURRENCY EXCHANGE': 'symbols',
    'CHART WITH UPWARDS TREND AND YEN SIGN': 'objects', 'LINK SYMBOL': 'objects', 'SATELLITE ANTENNA': 'objects',
    'WAVING WHITE FLAG': 'travel', 'WAVING BLACK FLAG': 'travel', 'CHEQUERED FLAG': 'travel', 'TRIANGULAR FLAG ON POST': 'travel',
    'ROLLING ON THE FLOOR LAUGHING': 'smileys', 'THREE BUTTON MOUSE': 'objects', 'PERSON IN LOTUS POSITION': 'people', 'PALMS UP TOGETHER': 'people', 'SHRUG': 'people', 'FENCER': 'people', 'HANDBALL': 'people', 'MOTHER CHRISTMAS': 'people', 'FATHER CHRISTMAS': 'people', 'SLEUTH OR SPY': 'people', 'INDEX POINTING AT THE VIEWER': 'people', 'THOUGHT BALLOON': 'smileys', 'FIRST QUARTER MOON SYMBOL': 'travel', 'FIRST QUARTER MOON WITH FACE': 'travel', 'LOWER LEFT FOUNTAIN PEN': 'objects', 'PIG NOSE': 'animals', 'FACE MASSAGE': 'people', 'HAIRCUT': 'people', 'BISON': 'animals', 'OYSTER': 'food', 'BOW AND ARROW': 'activities',
    'CROSSED FLAGS': 'travel', 'STATUE OF LIBERTY': 'travel', 'MOYAI': 'travel', 'SILHOUETTE OF JAPAN': 'travel', 'TOKYO TOWER': 'travel',
}

def classify(cp, name):
    if name in OVERRIDE: return OVERRIDE[name]
    w = set(name.split())
    if 'CLOCK' in w and 'FACE' in w: return 'travel'
    if 0x1F600 <= cp <= 0x1F64F:
        return 'smileys' if ({'FACE', 'CAT', 'MONKEY'} & w) else 'people'
    if w & {'HEART', 'HEARTS'} and not ({'SUIT', 'PLAYING', 'HANDS'} & w): return 'smileys'
    if w & ANIMALS and not ({'MOON', 'SUN'} & w): return 'animals'
    if 'FACE' in w and not ({'MOON', 'SUN'} & w): return 'smileys'
    if w & FOOD: return 'food'
    if 0x1F680 <= cp <= 0x1F6FF:
        if w & PEOPLE: return 'people'
        if {'SIGN', 'SYMBOL', 'NO', 'BAGGAGE', 'RESTROOM', 'MENS', 'WOMENS', 'CUSTOMS', 'PASSPORT', 'LEFT', 'WC', 'PLACE'} & w: return 'symbols'
        if w & OBJECTS: return 'objects'
        return 'travel'
    for g, ws in (('people', PEOPLE), ('activities', ACTIV), ('travel', TRAVEL), ('objects', OBJECTS)):
        if w & ws: return g
    if w & SMILEY: return 'smileys'
    if cp < 0x1F000 or 0x1F170 <= cp <= 0x1F251 or 0x1F7E0 <= cp <= 0x1F7F0: return 'symbols'
    if w & {'SIGN', 'SYMBOL', 'SQUARED', 'BUTTON', 'MARK', 'ARROW', 'ARROWS', 'CIRCLE', 'SQUARE', 'DIAMOND', 'TRIANGLE',
            'KEYCAP', 'CLOCKWISE', 'ANTICLOCKWISE', 'SPEAKER', 'BELL', 'SYMBOLS', 'INPUT', 'MENORAH', 'OM', 'SIX', 'CROSS',
            'TWISTED', 'REPEAT', 'BACK', 'END', 'SOON', 'TOP', 'ON', 'IDENTIFICATION', 'PLACE'}: return 'symbols'
    return 'objects'

seen, items = set(), []
def add(ch, name, grp):
    if ch in seen: return
    seen.add(ch)
    items.append([ch, name.lower(), G[grp]])

for cp in BMP + SMP:
    if cp in SKIP: continue
    try: name = ud.name(chr(cp))
    except ValueError: continue  # non attribué
    if cp >= 0x1F000 and ud.category(chr(cp)) not in ('So', 'Sk'): continue
    ch = chr(cp) + ('️' if cp < 0x1F000 or cp in TEXT_DEFAULT else '')
    add(ch, name, classify(cp, name))

for seq in ZWJ:
    parts = [ud.name(c) for c in seq if c not in '‍️']
    add(seq, ' + '.join(parts), classify(ord(seq[0]), parts[0]))

items.sort(key=lambda x: x[2])  # tri stable : ordre Unicode dans chaque groupe
data = {'version': ud.unidata_version, 'groups': [[k, label, ic] for k, label, ic in GROUPS], 'emojis': items}
js = ('// RobotConsole — liste des emojis (générée depuis la base Unicode %s, ne pas modifier à la main)\n'
      'window.EMOJI_DATA = %s;\n') % (ud.unidata_version, json.dumps(data, ensure_ascii=False, separators=(',', ':')))
open(out_path, 'w', encoding='utf8').write(js)
c = Counter(x[2] for x in items)
print(len(items), {GROUPS[k][0]: v for k, v in sorted(c.items())}, len(js) // 1024, 'Ko')
if '--show' in sys.argv:
    for gi, g in enumerate(GROUPS): print(g[1], ''.join(e[0] for e in items if e[2] == gi))
