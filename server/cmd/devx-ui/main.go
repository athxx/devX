package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/getlantern/systray"

	"devx/server/internal/config"
	serverruntime "devx/server/internal/runtime"
	"devx/server/internal/ui"
)

func main() {
	cfg := config.Load()
	manager := serverruntime.NewServerManager(cfg)

	signalChannel := make(chan os.Signal, 1)
	signal.Notify(signalChannel, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signalChannel
		_ = manager.Stop()
		systray.Quit()
	}()

	onReady := func() {
		icon := ui.TrayIcon()
		systray.SetIcon(icon)
		if runtime.GOOS == "darwin" {
			systray.SetTemplateIcon(icon, icon)
		}
		systray.SetTitle("DEVX")
		systray.SetTooltip("DEVX local relay server")

		statusItem := systray.AddMenuItem("Stopped", "Current DEVX server status")
		statusItem.Disable()

		startItem := systray.AddMenuItem("Start", "Start DEVX server")
		stopItem := systray.AddMenuItem("Stop", "Stop DEVX server")
		stopItem.Disable()

		systray.AddSeparator()
		portsHeader := systray.AddMenuItem("Ports", "Selectable listener ports")
		portsHeader.Disable()

		selectedPort := cfg.Port
		portItems := make(map[string]*systray.MenuItem, len(cfg.PortOptions))
		for _, port := range cfg.PortOptions {
			item := systray.AddMenuItemCheckbox(port, fmt.Sprintf("Use port %s", port), port == selectedPort)
			if cfg.PortLocked {
				item.Disable()
			}
			portItems[port] = item
		}

		if cfg.PortLocked {
			lockItem := systray.AddMenuItem(manager.LockedPortLabel(), "Port is controlled by environment")
			lockItem.Disable()
		}

		systray.AddSeparator()
		quitItem := systray.AddMenuItem("Quit", "Quit DEVX tray")

		updateMenu := func() {
			status := manager.Status()
			label := fmt.Sprintf("Stopped · %s", status.Port)
			if status.Running {
				label = fmt.Sprintf("Running · %s", status.Port)
			}
			if status.LastError != "" {
				label = fmt.Sprintf("%s · %s", label, status.LastError)
			}
			statusItem.SetTitle(label)

			if status.Running {
				startItem.Disable()
				stopItem.Enable()
			} else {
				startItem.Enable()
				stopItem.Disable()
			}

			for port, item := range portItems {
				if port == status.Port {
					item.Check()
				} else {
					item.Uncheck()
				}
			}
		}

		updateMenu()

		go func() {
			for {
				select {
				case <-startItem.ClickedCh:
					if err := manager.Start(selectedPort); err != nil {
						log.Printf("start server: %v", err)
					}
					updateMenu()
				case <-stopItem.ClickedCh:
					if err := manager.Stop(); err != nil {
						log.Printf("stop server: %v", err)
					}
					updateMenu()
				case <-quitItem.ClickedCh:
					_ = manager.Stop()
					systray.Quit()
					return
				}
			}
		}()

		for port, item := range portItems {
			currentPort := port
			currentItem := item
			go func() {
				for range currentItem.ClickedCh {
					selectedPort = currentPort
					if cfg.PortLocked {
						updateMenu()
						continue
					}
					if err := manager.SelectPort(currentPort); err != nil {
						log.Printf("select port %s: %v", currentPort, err)
					}
					updateMenu()
				}
			}()
		}
	}

	onExit := func() {
		if err := manager.Stop(); err != nil {
			log.Printf("stop on exit: %v", err)
		}
	}

	systray.Run(onReady, onExit)
}
