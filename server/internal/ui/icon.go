package ui

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

func TrayIconRunning() []byte {
	return trayCircleIcon(color.NRGBA{R: 0xFF, G: 0xBF, B: 0x00, A: 0xFF})
}

func TrayIconStopped() []byte {
	return trayCircleIcon(color.NRGBA{R: 0x9A, G: 0x9A, B: 0x9A, A: 0xFF})
}

func trayCircleIcon(fill color.NRGBA) []byte {
	canvas := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	transparent := color.NRGBA{A: 0}

	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			canvas.SetNRGBA(x, y, transparent)
		}
	}

	for y := 1; y < 15; y++ {
		for x := 1; x < 15; x++ {
			if (x-8)*(x-8)+(y-8)*(y-8) <= 36 {
				canvas.SetNRGBA(x, y, fill)
			}
		}
	}

	var buffer bytes.Buffer
	_ = png.Encode(&buffer, canvas)
	return buffer.Bytes()
}
