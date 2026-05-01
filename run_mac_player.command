#!/bin/bash

echo "=========================================="
echo "    Welcome to FHSS Staff Matcher!"
echo "=========================================="
echo ""
echo "Please enter the IP address of the Host Mac."
echo "(You can find this on the Host's terminal when they start the server)"
echo "Example: 192.168.1.5"
echo ""

read -p "Server IP Address: " SERVER_IP

if [ -z "$SERVER_IP" ]; then
    echo "No IP address entered. Exiting."
    sleep 2
    exit 1
fi

echo ""
echo "Connecting to $SERVER_IP..."
sleep 1

# Open the default web browser to the server IP and port 8080
open "http://$SERVER_IP:8080"
