import qrcode
from PIL import Image, ImageDraw, ImageFont
import os

def generate_poster(target_url, output_png, label_text="Wi-Fi Mobile Access"):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=2,
    )
    qr.add_data(target_url)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color="#06203d", back_color="#ffffff").convert('RGB')

    card_w, card_h = 700, 930
    card = Image.new('RGB', (card_w, card_h), '#ffffff')
    draw = ImageDraw.Draw(card)

    def get_font(size, bold=False):
        font_paths = [
            "C:\\Windows\\Fonts\\segoeuib.ttf" if bold else "C:\\Windows\\Fonts\\segoeui.ttf",
            "C:\\Windows\\Fonts\\arialbd.ttf" if bold else "C:\\Windows\\Fonts\\arial.ttf",
        ]
        for p in font_paths:
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    pass
        return ImageFont.load_default()

    title_font = get_font(42, bold=True)
    subtitle_font = get_font(18, bold=True)
    pill_font = get_font(12, bold=True)
    badge_font = get_font(13, bold=True)
    heading_font = get_font(26, bold=True)
    subheading_font = get_font(16, bold=False)
    url_font = get_font(15, bold=True)
    footer_font = get_font(13, bold=False)

    # Header gradient
    header_h = 185
    for y in range(header_h):
        r = int(10 + (2 - 10) * (y / header_h))
        g = int(54 + (132 - 54) * (y / header_h))
        b = int(99 + (199 - 99) * (y / header_h))
        draw.line([(0, y), (card_w, y)], fill=(r, g, b))

    # Top pill
    draw.rounded_rectangle([180, 20, 520, 52], radius=16, fill="#ffffff")
    draw.text((350, 36), f"PCCOE INNOVATION • {label_text.upper()}", fill="#0a3663", font=pill_font, anchor="mm")

    # Header titles
    draw.text((350, 100), "MedNexa", fill="#ffffff", font=title_font, anchor="mm")
    draw.text((350, 145), "24x7 Night Emergency Chemists & Jan Aushadhi Hubs", fill="#bae6fd", font=subtitle_font, anchor="mm")

    # Call to action
    draw.text((350, 235), "Scan with Phone Camera to Open", fill="#0f172a", font=heading_font, anchor="mm")
    draw.text((350, 270), "Point your smartphone camera at this scanner • Opens website instantly", fill="#64748b", font=subheading_font, anchor="mm")

    # QR Code Frame
    qr_display_size = 380
    qr_resized = qr_img.resize((qr_display_size, qr_display_size), Image.Resampling.LANCZOS)
    qr_x = (card_w - qr_display_size) // 2
    qr_y = 310

    draw.rounded_rectangle([qr_x - 14, qr_y - 14, qr_x + qr_display_size + 14, qr_y + qr_display_size + 14], radius=20, fill="#f8fafc", outline="#cbd5e1", width=2)
    card.paste(qr_resized, (qr_x, qr_y))

    # Corner accents
    accent_len = 24
    accent_color = "#0284c7"
    accent_width = 4
    draw.line([(qr_x - 8, qr_y - 8), (qr_x - 8 + accent_len, qr_y - 8)], fill=accent_color, width=accent_width)
    draw.line([(qr_x - 8, qr_y - 8), (qr_x - 8, qr_y - 8 + accent_len)], fill=accent_color, width=accent_width)
    draw.line([(qr_x + qr_display_size + 8, qr_y - 8), (qr_x + qr_display_size + 8 - accent_len, qr_y - 8)], fill=accent_color, width=accent_width)
    draw.line([(qr_x + qr_display_size + 8, qr_y - 8), (qr_x + qr_display_size + 8, qr_y - 8 + accent_len)], fill=accent_color, width=accent_width)
    draw.line([(qr_x - 8, qr_y + qr_display_size + 8), (qr_x - 8 + accent_len, qr_y + qr_display_size + 8)], fill=accent_color, width=accent_width)
    draw.line([(qr_x - 8, qr_y + qr_display_size + 8), (qr_x - 8, qr_y + qr_display_size + 8 - accent_len)], fill=accent_color, width=accent_width)
    draw.line([(qr_x + qr_display_size + 8, qr_y + qr_display_size + 8), (qr_x + qr_display_size + 8 - accent_len, qr_y + qr_display_size + 8)], fill=accent_color, width=accent_width)
    draw.line([(qr_x + qr_display_size + 8, qr_y + qr_display_size + 8), (qr_x + qr_display_size + 8, qr_y + qr_display_size + 8 - accent_len)], fill=accent_color, width=accent_width)

    # Badges
    draw.rounded_rectangle([130, 725, 260, 758], radius=16, fill="#fef2f2", outline="#fecaca", width=1)
    draw.text((195, 741), "24x7 EMERGENCY", fill="#dc2626", font=badge_font, anchor="mm")

    draw.rounded_rectangle([280, 725, 420, 758], radius=16, fill="#eff6ff", outline="#bfdbfe", width=1)
    draw.text((350, 741), "JAN AUSHADHI", fill="#1d4ed8", font=badge_font, anchor="mm")

    draw.rounded_rectangle([440, 725, 570, 758], radius=16, fill="#f0fdf4", outline="#bbf7d0", width=1)
    draw.text((505, 741), "NO APP NEEDED", fill="#15803d", font=badge_font, anchor="mm")

    # URL Box
    draw.rounded_rectangle([100, 780, 600, 826], radius=12, fill="#f8fafc", outline="#cbd5e1", width=1)
    draw.text((350, 803), target_url, fill="#0284c7", font=url_font, anchor="mm")

    # Footer attribution
    draw.text((350, 860), "Pimpri Chinchwad College of Engineering (PCCOE) • Healthcare Technology", fill="#64748b", font=footer_font, anchor="mm")
    draw.text((350, 885), "Works on all smartphones (iPhone, Android) via built-in Camera or Google Lens", fill="#94a3b8", font=footer_font, anchor="mm")

    # Border
    draw.rectangle([0, 0, card_w - 1, card_h - 1], outline="#e2e8f0", width=2)

    card.save(output_png, quality=95)
    print(f"Generated {output_png} for URL: {target_url}")

# 1. Wi-Fi Local Scanner (Direct phone access on your home/office Wi-Fi)
generate_poster("http://192.168.0.102:8080/index.html", "medifinder-wifi-scanner.png", "Local Wi-Fi Access")

# 2. Public / Online Scanner
generate_poster("https://snehalghadge59-blip.github.io/industrial-data-dashboard/", "medifinder-scanner.png", "Live Cloud Access")
