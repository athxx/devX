package ui

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

func TrayIcon() []byte {
	canvas := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	green := color.NRGBA{R: 40, G: 200, B: 64, A: 255}
	dark := color.NRGBA{R: 12, G: 18, B: 24, A: 230}
	transparent := color.NRGBA{A: 0}

	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			canvas.SetNRGBA(x, y, transparent)
		}
	}

	for y := 2; y < 14; y++ {
		for x := 2; x < 14; x++ {
			if (x-8)*(x-8)+(y-8)*(y-8) <= 36 {
				canvas.SetNRGBA(x, y, green)
			}
		}
	}

	for y := 5; y < 11; y++ {
		for x := 5; x < 11; x++ {
			if (x-8)*(x-8)+(y-8)*(y-8) <= 9 {
				canvas.SetNRGBA(x, y, dark)
			}
		}
	}

	var buffer bytes.Buffer
	_ = png.Encode(&buffer, canvas)
	return buffer.Bytes()
}
