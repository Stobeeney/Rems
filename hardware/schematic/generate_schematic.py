#!/usr/bin/env python3
"""Generate the REMS control-wiring schematic (KiCad 9/10 .kicad_sch) from the pin maps in code.

Sources of truth:
  backend/app.py                          relay_pins, HLK_PINS (Raspberry Pi 5 GPIO)
  hardware/esp32_11_pzem_multiplexer.ino  PIN_S0..S3, PZEM_RX_PIN, PZEM_TX_PIN, TOTAL_PZEM_CHANNELS

Every connection is a named net: each pin gets a short wire stub ending in a net label, and
pins with the same label are connected (standard KiCad net-label wiring). Control wiring only;
mains/AC wiring is out of scope.

Usage:
  python3 hardware/schematic/generate_schematic.py
  # then (optional) export with KiCad:
  kicad-cli sch export pdf hardware/schematic/rems-control-wiring.kicad_sch
"""
import re
import uuid
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = HERE / "rems-control-wiring.kicad_sch"
PROJECT = OUT.stem
GRID = 1.27
FONT = 1.27

# --------------------------------------------------------------------------- sources of truth
app_src = (REPO / "backend/app.py").read_text()
ino_src = (REPO / "hardware/esp32_11_pzem_multiplexer.ino").read_text()

relay_pins = {int(r): int(g) for r, g in
              re.findall(r"(\d+): (\d+)", app_src.split("relay_pins = {")[1].split("}")[0])}
hlk_pins = {z: int(g) for z, g in re.findall(r'"(zone\d)": (\d+)', app_src.split("HLK_PINS = {")[1].split("}")[0])}
ino_define = {k: v for k, v in re.findall(r"#define\s+(\w+)\s+(\d+)", ino_src)}
MUX_SEL = [int(ino_define[f"PIN_S{i}"]) for i in range(4)]
ESP_RX, ESP_TX = int(ino_define["PZEM_RX_PIN"]), int(ino_define["PZEM_TX_PIN"])
N_PZEM = int(ino_define["TOTAL_PZEM_CHANNELS"])

assert sorted(relay_pins) == list(range(1, 21)), "expected relays 1..20 in backend/app.py"
assert len(set(relay_pins.values()) | set(hlk_pins.values())) == 24, "GPIO used twice?"

RELAY_NET = {
    1: "RLY01_PFC_K1", 2: "RLY02_PFC_K2", 3: "RLY03_PFC_K3", 4: "RLY04_LR_LIGHTS", 5: "RLY05_LR_TV",
    6: "RLY06_LR_OUTLET1", 7: "RLY07_ACU", 8: "RLY08_BR1_LIGHTS", 9: "RLY09_BR1_OUTLET2", 10: "RLY10_FRIDGE",
    11: "RLY11_KITCHEN_OUT", 12: "RLY12_WATER_HEATER", 13: "RLY13_WASHER", 14: "RLY14_MICROWAVE",
    15: "RLY15_GARAGE", 16: "RLY16_DINING_LIGHTS", 17: "RLY17_OUTDOOR_LIGHTS", 18: "RLY18_CCTV_NVR",
    19: "RLY19_STANDBY_OUT", 20: "RLY20_AUX",
}
HLK_NET = {"zone1": "HLK1_LIVING_ROOM", "zone2": "HLK2_MASTER_BR", "zone3": "HLK3_BEDROOM2", "zone4": "HLK4_KITCHEN"}
GPIO_NET = {g: RELAY_NET[r] for r, g in relay_pins.items()}
GPIO_NET.update({g: HLK_NET[z] for z, g in hlk_pins.items()})
GPIO_NET.update({2: "I2C_SDA", 3: "I2C_SCL"})

# Raspberry Pi 40-pin header: physical pin -> (pin name, net or None for no-connect)
ALT = {2: "SDA", 3: "SCL", 14: "TXD", 15: "RXD", 10: "MOSI", 9: "MISO", 11: "SCLK", 8: "CE0", 7: "CE1"}
HEADER_FN = {1: "3V3", 2: "5V", 3: 2, 4: "5V", 5: 3, 6: "GND", 7: 4, 8: 14, 9: "GND", 10: 15, 11: 17, 12: 18,
             13: 27, 14: "GND", 15: 22, 16: 23, 17: "3V3", 18: 24, 19: 10, 20: "GND", 21: 9, 22: 25, 23: 11,
             24: 8, 25: "GND", 26: 7, 27: "ID_SD", 28: "ID_SC", 29: 5, 30: "GND", 31: 6, 32: 12, 33: 13,
             34: "GND", 35: 19, 36: 16, 37: 26, 38: 20, 39: "GND", 40: 21}


def header_pin(phys):
    fn = HEADER_FN[phys]
    if fn == "3V3":
        return "3V3", "+3V3"
    if fn == "5V":
        return "5V", "+5V"
    if fn == "GND":
        return "GND", "GND"
    if fn in ("ID_SD", "ID_SC"):
        return fn, None
    name = f"GPIO{fn}" + (f"/{ALT[fn]}" if fn in ALT else "")
    return name, GPIO_NET.get(fn)


# --------------------------------------------------------------------------- s-expression helpers
def uid():
    return str(uuid.uuid4())


def snap(v):
    return round(round(v / GRID) * GRID, 2)


def fmt(v):
    return f"{round(v, 4):g}"


def font(size=FONT, bold=False):
    return f"(effects (font (size {size} {size}){' (bold yes)' if bold else ''}))"


class Part:
    """A rectangular symbol. pins: list of (number, name, side 'L'|'R', net-or-None)."""

    def __init__(self, ref, value, lib_name, pins, half_w, show_numbers=False, description=""):
        self.ref, self.value, self.lib_name = ref, value, lib_name
        self.half_w, self.show_numbers, self.description = half_w, show_numbers, description
        left = [p for p in pins if p[2] == "L"]
        right = [p for p in pins if p[2] == "R"]
        rows = max(len(left), len(right))
        top = (rows - 1) * 2.54 / 2
        top = round(round(top / GRID) * GRID, 2)
        self.top, self.bottom = top, top - (rows - 1) * 2.54
        self.pins = []  # (number, name, side, net, x, y) in symbol coords (y up)
        for side, group in (("L", left), ("R", right)):
            for i, (num, name, _s, net) in enumerate(group):
                x = -(half_w + 2.54) if side == "L" else (half_w + 2.54)
                self.pins.append((num, name, side, net, x, round(top - i * 2.54, 2)))

    def lib_symbol(self):
        hw, t, b = self.half_w, self.top + 2.54, self.bottom - 2.54
        out = [f'(symbol "REMS:{self.lib_name}"',
               f'(pin_numbers (hide {"no" if self.show_numbers else "yes"}))',
               '(pin_names (offset 0.508))', '(exclude_from_sim yes) (in_bom yes) (on_board yes)',
               f'(property "Reference" "{re.sub(r"[0-9]+$", "", self.ref)}" (at 0 {fmt(t + 2.54)} 0) {font()})',
               f'(property "Value" "{self.lib_name}" (at 0 {fmt(b - 2.54)} 0) {font()})',
               f'(property "Footprint" "" (at 0 0 0) (effects (font (size {FONT} {FONT})) (hide yes)))',
               f'(property "Datasheet" "" (at 0 0 0) (effects (font (size {FONT} {FONT})) (hide yes)))',
               f'(property "Description" "{self.description}" (at 0 0 0) (effects (font (size {FONT} {FONT})) (hide yes)))',
               f'(symbol "{self.lib_name}_0_1"',
               f'(rectangle (start {fmt(-hw)} {fmt(t)}) (end {fmt(hw)} {fmt(b)}) '
               '(stroke (width 0.254) (type default)) (fill (type background))))',
               f'(symbol "{self.lib_name}_1_1"']
        for num, name, side, _net, x, y in self.pins:
            angle = 0 if side == "L" else 180
            out.append(f'(pin passive line (at {fmt(x)} {fmt(y)} {angle}) (length 2.54) '
                       f'(name "{name}" {font()}) (number "{num}" {font()}))')
        out.append("))")
        return "\n".join(out)

    def place(self, X, Y, sheet_uuid, items, net_use):
        X, Y = snap(X), snap(Y)
        t, b = self.top + 2.54, self.bottom - 2.54
        inst = [f'(symbol (lib_id "REMS:{self.lib_name}") (at {fmt(X)} {fmt(Y)} 0) (unit 1)',
                '(exclude_from_sim yes) (in_bom yes) (on_board yes) (dnp no)', f'(uuid "{uid()}")',
                f'(property "Reference" "{self.ref}" (at {fmt(X)} {fmt(Y - t - 2.54)} 0) {font(1.524, True)})',
                f'(property "Value" "{self.value}" (at {fmt(X)} {fmt(Y - b + 2.54)} 0) {font()})',
                f'(property "Footprint" "" (at {fmt(X)} {fmt(Y)} 0) (effects (font (size {FONT} {FONT})) (hide yes)))',
                f'(property "Datasheet" "" (at {fmt(X)} {fmt(Y)} 0) (effects (font (size {FONT} {FONT})) (hide yes)))',
                f'(property "Description" "{self.description}" (at {fmt(X)} {fmt(Y)} 0) (effects (font (size {FONT} {FONT})) (hide yes)))']
        for num, *_ in self.pins:
            inst.append(f'(pin "{num}" (uuid "{uid()}"))')
        inst.append(f'(instances (project "{PROJECT}" (path "/{sheet_uuid}" (reference "{self.ref}") (unit 1))))')
        inst.append(")")
        items.append("\n".join(inst))

        for num, name, side, net, x, y in self.pins:
            ex, ey = round(X + x, 2), round(Y - y, 2)
            if net is None:
                items.append(f'(no_connect (at {fmt(ex)} {fmt(ey)}) (uuid "{uid()}"))')
                continue
            lx = round(ex - 2.54 if side == "L" else ex + 2.54, 2)
            items.append(f'(wire (pts (xy {fmt(ex)} {fmt(ey)}) (xy {fmt(lx)} {fmt(ey)})) '
                         f'(stroke (width 0) (type default)) (uuid "{uid()}"))')
            angle, just = (180, "right") if side == "L" else (0, "left")
            items.append(f'(label "{net}" (at {fmt(lx)} {fmt(ey)} {angle}) '
                         f'(effects (font (size {FONT} {FONT})) (justify {just} bottom)) (uuid "{uid()}"))')
            net_use.setdefault(net, []).append(f"{self.ref}.{num} ({name})")


def text(items, x, y, lines, size=FONT, bold=False):
    body = "\\n".join(lines).replace('"', "'")
    items.append(f'(text "{body}" (exclude_from_sim no) (at {fmt(snap(x))} {fmt(snap(y))} 0) '
                 f'(effects (font (size {size} {size}){" (bold yes)" if bold else ""}) (justify left top)) (uuid "{uid()}"))')


# --------------------------------------------------------------------------- parts
parts = []

pi_pins = []
for phys in range(1, 41):
    name, net = header_pin(phys)
    pi_pins.append((str(phys), name, "L" if phys % 2 else "R", net))
J1 = Part("J1", "Raspberry Pi 5 - 40-pin GPIO header", "RPi5_GPIO_Header", pi_pins, 12.7, show_numbers=True,
          description="Pin numbers are PHYSICAL header pins")

J2 = Part("J2", "Raspberry Pi 5 - USB-A port", "RPi5_USB_A",
          [("1", "VBUS", "R", "USB_VBUS"), ("2", "D-", "R", "USB_DN"), ("3", "D+", "R", "USB_DP"), ("4", "GND", "R", "GND")], 6.35)

relay_board_pins = [(str(i), f"IN{i}", "L", RELAY_NET[i]) for i in range(1, 21)]
relay_board_pins += [("21", "VCC", "L", "+3V3"), ("22", "GND", "L", "RLY_PSU_GND"), ("23", "JD-VCC", "L", "RLY_PSU_5V")]
K1 = Part("K1", "20-ch opto relay board (active-LOW)", "Relay_Board_20ch", relay_board_pins, 10.16,
          description="Remove VCC-JD-VCC jumper. IN low = relay ON")

PS1 = Part("PS1", "5V >=2A relay coil supply", "PSU_5V",
           [("1", "+5V", "R", "RLY_PSU_5V"), ("2", "GND", "R", "RLY_PSU_GND")], 6.35)

U1 = Part("U1", "DS3231 RTC module (I2C 0x68)", "DS3231_Module",
          [("1", "32K", "L", None), ("2", "SQW", "L", None), ("3", "SCL", "L", "I2C_SCL"),
           ("4", "SDA", "L", "I2C_SDA"), ("5", "VCC", "L", "+3V3"), ("6", "GND", "L", "GND")], 7.62)

hlk_parts = []
for k, (zone, gpio) in enumerate(sorted(hlk_pins.items())):
    area = HLK_NET[zone].split("_", 1)[1].replace("_", " ").title().replace("Br", "BR")
    hlk_parts.append(Part(f"U{2 + k}", f"HLK-LD2410B {zone} - {area}", "HLK_LD2410B",
                          [("1", "TX", "L", None), ("2", "RX", "L", None), ("3", "OUT", "L", HLK_NET[zone]),
                           ("4", "GND", "L", "GND"), ("5", "VCC", "L", "+5V")], 7.62))

U6 = Part("U6", "ESP32 DevKit (USB to Pi)", "ESP32_DevKit",
          [("1", "VBUS(5V)", "L", "USB_VBUS"), ("2", "D-", "L", "USB_DN"), ("3", "D+", "L", "USB_DP"),
           ("4", "GND", "L", "GND"),
           ("5", f"GPIO{MUX_SEL[0]}", "R", "MUX_S0"), ("6", f"GPIO{MUX_SEL[1]}", "R", "MUX_S1"),
           ("7", f"GPIO{MUX_SEL[2]}", "R", "MUX_S2"), ("8", f"GPIO{MUX_SEL[3]}", "R", "MUX_S3"),
           ("9", f"GPIO{ESP_RX}/RX1", "R", "MUX_SIG"), ("10", f"GPIO{ESP_TX}/TX1", "R", "PZEM_RX_BUS"),
           ("11", "3V3", "R", "ESP_3V3"), ("12", "GND", "R", "GND")], 8.89)

mux_pins = [("1", "SIG", "L", "MUX_SIG")] + [(str(2 + i), f"S{i}", "L", f"MUX_S{i}") for i in range(4)]
mux_pins += [("6", "EN", "L", "GND"), ("7", "VCC", "L", "ESP_3V3"), ("8", "GND", "L", "GND")]
mux_pins += [(str(9 + c), f"C{c}", "R", f"PZEM_TX_C{c}" if c < N_PZEM else None) for c in range(16)]
U7 = Part("U7", "CD74HC4067 mux breakout", "CD74HC4067_Module", mux_pins, 7.62)

pzem_parts = []
for ch in range(N_PZEM):
    label = "Main Panel" if ch == 0 else f"Branch {ch} (R{ch + 3})"
    pzem_parts.append(Part(f"U{8 + ch}", f"PZEM #{ch} {label}", "PZEM004T_v3_TTL",
                           [("1", "5V", "L", "ESP_3V3"), ("2", "RX", "L", "PZEM_RX_BUS"),
                            ("3", "TX", "L", f"PZEM_TX_C{ch}"), ("4", "GND", "L", "GND")], 6.35,
                           description="TTL side powered from ESP32 3V3"))

# --------------------------------------------------------------------------- layout (A2, mm, y down)
sheet_uuid = uid()
items, net_use = [], {}

J1.place(62, 78, sheet_uuid, items, net_use)
J2.place(62, 128, sheet_uuid, items, net_use)
U1.place(142, 36, sheet_uuid, items, net_use)
for k, p in enumerate(hlk_parts):
    p.place(142 + (k // 2) * 55, 72 + (k % 2) * 32, sheet_uuid, items, net_use)
K1.place(272, 80, sheet_uuid, items, net_use)
PS1.place(232, 128, sheet_uuid, items, net_use)

U6.place(42, 205, sheet_uuid, items, net_use)
U7.place(118, 205, sheet_uuid, items, net_use)
for ch, p in enumerate(pzem_parts):
    col, row = ch % 4, ch // 4
    p.place(190 + col * 56, 168 + row * 32, sheet_uuid, items, net_use)

text(items, 15, 16, ["RASPBERRY PI 5 DOMAIN  (relays, presence sensors, RTC)"], 1.8, True)
text(items, 15, 150, ["ESP32 DOMAIN  (11x PZEM-004T via CD74HC4067, all 3.3V logic)"], 1.8, True)
text(items, 300, 16, [
    "WIRING NOTES",
    "1. Same label name = same wire. Connect every pin that shares a label.",
    "   Full pin-to-pin list: NETLIST.md",
    "2. J1 pin numbers are PHYSICAL header pins (not BCM).",
    "3. K1 relay board: REMOVE the VCC/JD-VCC jumper.",
    "   VCC = Pi 3V3 (opto LEDs); JD-VCC + GND = PS1 (5V >=2A).",
    "   Do NOT tie Pi GND to K1 GND (keeps opto isolation).",
    "4. Relays are active-LOW: GPIO LOW = relay ON.",
    "   RLY01-03 drive the PFC capacitor-bank contactors.",
    "5. GPIO14/15 (HLK zones 1-2) are UART pins:",
    "   disable serial console + serial hardware.",
    "6. Keep SPI (GPIO7-11) and audio/PWM overlays",
    "   (GPIO12/13/18/19) disabled.",
    "7. Boot check: GPIO9-27 pull down at power-up, so relays",
    "   may click ON until app.py starts. Fix if needed:",
    "   config.txt: gpio=9-13,16-24,27=op,dh",
    "8. ESP32 side is all 3.3V: PZEM TTL '5V' pins and mux",
    "   VCC come from ESP32 3V3 (ESP_3V3). No level shifter.",
    "9. PZEM_RX_BUS: ESP32 TX1 -> RX of ALL PZEMs. The mux",
    "   returns only the selected PZEM TX to ESP32 RX1.",
    "10. Mux EN = GND (always on). C11-C15 unused.",
    "11. Control wiring only: mains side not shown.",
], 1.27)

# --------------------------------------------------------------------------- write
lib = "\n".join(p.lib_symbol() for p in
                {type(p).__name__ + p.lib_name: p for p in [J1, J2, K1, PS1, U1, *hlk_parts, U6, U7, *pzem_parts]}.values())
doc = f"""(kicad_sch
(version 20250114)
(generator "rems_generate_schematic")
(generator_version "1.0")
(uuid "{sheet_uuid}")
(paper "A3")
(title_block
(title "REMS - Control Wiring Schematic")
(date "{date.today().isoformat()}")
(rev "1.0")
(company "REMS / RECMS Thesis")
(comment 1 "Generated by generate_schematic.py from app.py + ESP32 .ino")
(comment 2 "Control (low-voltage) wiring only")
)
(lib_symbols
{lib}
)
{chr(10).join(items)}
(sheet_instances (path "/" (page "1")))
(embedded_fonts no)
)
"""
OUT.write_text(doc)

# Matching symbol library + project files so KiCad resolves the "REMS" library (clean ERC)
sym_lib = lib.replace('(symbol "REMS:', '(symbol "')
(HERE / "REMS.kicad_sym").write_text(
    f'(kicad_symbol_lib\n(version 20241209)\n(generator "rems_generate_schematic")\n(generator_version "1.0")\n{sym_lib}\n)\n')
(HERE / "sym-lib-table").write_text(
    '(sym_lib_table\n(version 7)\n(lib (name "REMS")(type "KiCad")(uri "${KIPRJMOD}/REMS.kicad_sym")(options "")(descr "REMS custom symbols"))\n)\n')
pro = HERE / f"{PROJECT}.kicad_pro"
if not pro.exists():
    pro.write_text('{\n  "meta": {\n    "filename": "' + pro.name + '",\n    "version": 1\n  }\n}\n')

# Single-pin nets mean a typo or a missing connection
lonely = {n: u for n, u in net_use.items() if len(u) < 2}
assert not lonely, f"nets with only one pin: {lonely}"

net_md = ["# REMS control wiring: netlist", "",
          "Generated by `generate_schematic.py`. Each row is one wire/net; connect every listed pin together.", "",
          "| Net | Connects |", "|---|---|"]
for net in sorted(net_use, key=lambda n: (not n.startswith(("+", "GND", "RLY_PSU", "ESP_3V3")), n)):
    net_md.append(f"| `{net}` | {', '.join(net_use[net])} |")
(HERE / "NETLIST.md").write_text("\n".join(net_md) + "\n")
print(f"wrote {OUT.relative_to(REPO)} and NETLIST.md: {len(net_use)} nets")
