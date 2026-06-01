"""
AIOI PTL Controller - Stable Version with Auto-reconnect
แก้ไขปัญหาโปรแกรมค้างหลังจากรับ interrupt
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox, filedialog
import socket
import threading
import time
import json
import pandas as pd
from datetime import datetime
from typing import Optional, List
from dataclasses import dataclass, asdict
from collections import deque
import queue


@dataclass
class CommandItem:
    name: str
    command: str
    description: str = ""
    timeout: int = 10
    retry: int = 2


class PTLController:
    def __init__(self, root):
        self.root = root
        self.root.title("AIOI PTL Controller - Stable Version")
        self.root.geometry("1300x800")
        
        # Connection
        self.host = tk.StringVar(value="192.168.1.254")
        self.port = tk.IntVar(value=5003)
        self._seq = 0
        self._lock = threading.Lock()
        self._command_lock = threading.Lock()
        self._running = False
        self._receiver_running = False
        self._main_socket = None
        self._socket_lock = threading.Lock()
        self._reconnect_flag = False
        self._response_queue = queue.Queue()
        self._receiver_thread = None
        self._pending_command_seq = None
        
        # Message queue for GUI updates
        self.gui_queue = queue.Queue()
        
        # Stats
        self.stats = {
            "sent": 0, "ok": 0, "fail": 0, 
            "timeout": 0, "interrupts": 0, "acks": 0,
            "reconnects": 0
        }
        
        self.commands = []
        self.interrupt_history = deque(maxlen=100)
        self.interrupt_callbacks = []
        
        self.setup_ui()
        self.load_sample_commands()
        self.update_stats()
        
        # Start GUI update loop
        self.update_gui_queue()
        
        # Auto-start listener
        self.start_listener()
        
        # Handle window close
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
    
    def setup_ui(self):
        main = ttk.Frame(self.root, padding="10")
        main.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main.columnconfigure(1, weight=2)
        main.rowconfigure(2, weight=1)
        
        # Connection frame
        conn = ttk.LabelFrame(main, text="Connection", padding="10")
        conn.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0,10))
        
        ttk.Label(conn, text="Host:").grid(row=0, column=0)
        ttk.Entry(conn, textvariable=self.host, width=15).grid(row=0, column=1, padx=5)
        ttk.Label(conn, text="Port:").grid(row=0, column=2, padx=(10,0))
        ttk.Entry(conn, textvariable=self.port, width=6).grid(row=0, column=3, padx=5)
        
        self.conn_status = ttk.Label(conn, text="● Disconnected", foreground="red")
        self.conn_status.grid(row=0, column=4, padx=20)
        
        ttk.Button(conn, text="Connect", command=self.connect_ptl).grid(row=0, column=5, padx=2)
        ttk.Button(conn, text="Disconnect", command=self.disconnect_ptl).grid(row=0, column=6, padx=2)
        
        ttk.Label(conn, text="Seq:").grid(row=0, column=7, padx=(20,5))
        self.seq_label = ttk.Label(conn, text="000", foreground="blue", font=("Courier",10,"bold"))
        self.seq_label.grid(row=0, column=8)
        ttk.Button(conn, text="Reset Seq", command=self.reset_seq, width=8).grid(row=0, column=9, padx=5)
        
        # Manual command
        manual = ttk.LabelFrame(main, text="Manual Command", padding="10")
        manual.grid(row=1, column=0, sticky="nsew", padx=(0,5))
        
        ttk.Label(manual, text="Command:").grid(row=0, column=0)
        self.cmd_entry = ttk.Entry(manual, width=55, font=("Courier",10))
        self.cmd_entry.grid(row=0, column=1, padx=5, sticky="ew")
        self.cmd_entry.bind("<Return>", lambda e: self.send_manual())
        
        param = ttk.Frame(manual)
        param.grid(row=1, column=0, columnspan=2, pady=10)
        ttk.Label(param, text="Timeout:").pack(side=tk.LEFT)
        self.timeout_entry = ttk.Entry(param, width=6)
        self.timeout_entry.insert(0, "10")
        self.timeout_entry.pack(side=tk.LEFT, padx=5)
        ttk.Label(param, text="Retry:").pack(side=tk.LEFT, padx=(10,0))
        self.retry_entry = ttk.Entry(param, width=4)
        self.retry_entry.insert(0, "2")
        self.retry_entry.pack(side=tk.LEFT, padx=5)
        ttk.Button(param, text="Send", command=self.send_manual).pack(side=tk.LEFT, padx=20)
        ttk.Button(param, text="Clear", command=lambda: self.cmd_entry.delete(0,tk.END)).pack(side=tk.LEFT)
        
        # Quick buttons
        quick = ttk.LabelFrame(manual, text="Quick", padding="5")
        quick.grid(row=2, column=0, columnspan=2, pady=10, sticky="ew")
        
        buttons = [
            ("Show 456 #1", "PP5050000m111#0001  456"),
            ("Show 123 #1", "PP5050000m111#0001  123"),
            ("Show 789 #2", "PP5050000m111#0002  789"),
            ("Clear #1", "PP5050000m111#0001     "),
            ("Maintenance A", "A"),
            ("Reset R", "R"),
        ]
        for i, (text, cmd) in enumerate(buttons):
            btn = ttk.Button(quick, text=text, command=lambda c=cmd: self.set_command(c), width=14)
            btn.grid(row=i//3, column=i%3, padx=3, pady=2)
        
        # Builder
        builder = ttk.Frame(manual)
        builder.grid(row=3, column=0, columnspan=2, pady=5)
        ttk.Label(builder, text="Address:").pack(side=tk.LEFT)
        self.addr_entry = ttk.Entry(builder, width=6)
        self.addr_entry.insert(0, "0001")
        self.addr_entry.pack(side=tk.LEFT, padx=5)
        ttk.Label(builder, text="Value:").pack(side=tk.LEFT, padx=(10,0))
        self.value_entry = ttk.Entry(builder, width=6)
        self.value_entry.insert(0, "456")
        self.value_entry.pack(side=tk.LEFT, padx=5)
        ttk.Button(builder, text="Build", command=self.build_cmd).pack(side=tk.LEFT, padx=10)
        
        # Log viewer
        log_frame = ttk.LabelFrame(manual, text="Log", padding="5")
        log_frame.grid(row=4, column=0, columnspan=2, pady=10, sticky="nsew")
        manual.rowconfigure(4, weight=1)
        log_frame.rowconfigure(0, weight=1)
        log_frame.columnconfigure(0, weight=1)
        
        self.log_text = scrolledtext.ScrolledText(log_frame, height=12, font=("Consolas",9))
        self.log_text.grid(row=0, column=0, sticky="nsew")
        self.log_text.tag_config("ok", foreground="green")
        self.log_text.tag_config("error", foreground="red")
        self.log_text.tag_config("warn", foreground="orange")
        self.log_text.tag_config("info", foreground="blue")
        self.log_text.tag_config("int", foreground="purple", font=("Consolas",9,"bold"))
        
        btn_frame = ttk.Frame(log_frame)
        btn_frame.grid(row=1, column=0, pady=5)
        ttk.Button(btn_frame, text="Clear", command=lambda: self.log_text.delete(1.0,tk.END)).pack(side=tk.LEFT, padx=2)
        ttk.Button(btn_frame, text="Copy", command=self.copy_log).pack(side=tk.LEFT, padx=2)
        
        # Command list
        list_frame = ttk.LabelFrame(main, text="Command List", padding="10")
        list_frame.grid(row=1, column=1, rowspan=2, sticky="nsew")
        
        toolbar = ttk.Frame(list_frame)
        toolbar.pack(fill=tk.X, pady=(0,5))
        for text, cmd in [("Add",self.add_cmd), ("Edit",self.edit_cmd), ("Del",self.del_cmd),
                          ("Save",self.save_cmds), ("Load",self.load_cmds),
                          ("Run",self.run_all), ("Stop",self.stop_run)]:
            ttk.Button(toolbar, text=text, command=cmd).pack(side=tk.LEFT, padx=2)
        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(side=tk.LEFT, padx=5, fill=tk.Y)
        ttk.Button(toolbar, text="Import Excel", command=self.import_from_excel).pack(side=tk.LEFT, padx=2)
        ttk.Button(toolbar, text="Export Excel", command=self.export_to_excel).pack(side=tk.LEFT, padx=2)
        
        cols = ("name","command","desc","timeout","retry")
        self.tree = ttk.Treeview(list_frame, columns=cols, show="headings", height=18)
        self.tree.heading("name", text="Name")
        self.tree.heading("command", text="Command")
        self.tree.heading("desc", text="Description")
        self.tree.heading("timeout", text="T/O")
        self.tree.heading("retry", text="Retry")
        self.tree.column("name", width=100)
        self.tree.column("command", width=220)
        self.tree.column("desc", width=180)
        self.tree.column("timeout", width=50)
        self.tree.column("retry", width=50)
        
        scroll = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.bind("<Double-1>", lambda e: self.send_selected())
        
        # Interrupt history
        hist_frame = ttk.LabelFrame(main, text="Interrupt History (Real-time)", padding="5")
        hist_frame.grid(row=2, column=0, sticky="nsew")
        
        self.last_int_label = ttk.Label(hist_frame, text="Last interrupt: None", 
                                        foreground="purple", font=("",10,"bold"))
        self.last_int_label.pack(fill=tk.X, padx=5, pady=5)
        
        self.hist_list = tk.Listbox(hist_frame, height=7, font=("Consolas",9))
        self.hist_list.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # Status bar
        status = ttk.Frame(main)
        status.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(10,0))
        
        self.status_label = ttk.Label(status, text="Ready", relief=tk.SUNKEN, anchor=tk.W)
        self.status_label.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        self.stats_label = ttk.Label(status, text="", relief=tk.SUNKEN, width=55)
        self.stats_label.pack(side=tk.RIGHT)
        
        self.int_indicator = ttk.Label(status, text="", foreground="purple", font=("",10,"bold"))
        self.int_indicator.pack(side=tk.RIGHT, padx=10)
    
    def log(self, msg, tag="info"):
        """ใส่ log เข้า queue เพื่อแสดงใน GUI thread"""
        self.gui_queue.put(("log", msg, tag))
    
    def update_gui_queue(self):
        """ประมวลผล queue ใน GUI thread"""
        try:
            while True:
                item = self.gui_queue.get_nowait()
                if item[0] == "log":
                    _, msg, tag = item
                    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    icons = {"ok":"✅","error":"❌","warn":"⚠️","info":"ℹ️","int":"🔔"}
                    icon = icons.get(tag, "ℹ️")
                    self.log_text.insert(tk.END, f"[{ts}] {icon} {msg}\n", tag)
                    self.log_text.see(tk.END)
                elif item[0] == "update_stats":
                    self._update_stats_display()
                elif item[0] == "update_interrupt":
                    self._update_interrupt_display()
                elif item[0] == "update_seq":
                    self.seq_label.config(text=f"{item[1]:03d}")
                elif item[0] == "update_conn_status":
                    self.conn_status.config(text=item[1], foreground=item[2])
                elif item[0] == "update_int_indicator":
                    self.int_indicator.config(text=item[1])
                    if item[2]:
                        self.root.after(3000, lambda: self.int_indicator.config(text=""))
                elif item[0] == "update_last_int":
                    self.last_int_label.config(text=item[1])
        except queue.Empty:
            pass
        finally:
            self.root.after(50, self.update_gui_queue)
    
    def _update_stats_display(self):
        self.stats_label.config(
            text=f"Sent:{self.stats['sent']} OK:{self.stats['ok']} "
                 f"Fail:{self.stats['fail']} Int:{self.stats['interrupts']} "
                 f"Ack:{self.stats['acks']} Reconn:{self.stats['reconnects']}"
        )
    
    def _update_interrupt_display(self):
        self.hist_list.delete(0, tk.END)
        for item in reversed(self.interrupt_history):
            status = "✓" if item.get('acked') else "⏳"
            self.hist_list.insert(tk.END, f"{status} [{item['time']}] Addr:{item['address']} (seq={item['seq']})")

    def _clear_response_queue(self):
        while True:
            try:
                self._response_queue.get_nowait()
            except queue.Empty:
                break

    def _advance_seq(self):
        with self._lock:
            self._seq = (self._seq + 1) % 1000
            next_seq = self._seq
        self.gui_queue.put(("update_seq", next_seq))

    def _set_pending_command_seq(self, seq):
        with self._lock:
            self._pending_command_seq = seq

    def _clear_pending_command_seq(self):
        with self._lock:
            self._pending_command_seq = None

    def _get_pending_command_seq(self):
        with self._lock:
            return self._pending_command_seq

    def _mark_interrupt_acked(self, seq):
        for item in self.interrupt_history:
            if item['seq'] == seq and not item['acked']:
                item['acked'] = True
        self.gui_queue.put(("update_interrupt",))
    
    def copy_log(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.log_text.get(1.0, tk.END))
    
    def set_command(self, cmd):
        self.cmd_entry.delete(0, tk.END)
        self.cmd_entry.insert(0, cmd)
    
    def build_cmd(self):
        addr = self.addr_entry.get().strip().zfill(4)
        val = self.value_entry.get().strip()
        cmd = f"PP5050000m111#{addr}  {val}"
        if len(cmd) < 23:
            cmd = cmd.ljust(23)
        self.cmd_entry.delete(0, tk.END)
        self.cmd_entry.insert(0, cmd)
    
    def reset_seq(self):
        with self._lock:
            self._seq = 0
            self.gui_queue.put(("update_seq", self._seq))
            self.log("Sequence reset to 000", "info")
    
    def update_stats(self):
        self.gui_queue.put(("update_stats",))
    
    def register_interrupt_callback(self, callback):
        self.interrupt_callbacks.append(callback)
    
    def handle_interrupt(self, seq_no, address, raw_data):
        """จัดการ interrupt ที่ได้รับ (ทำงานใน thread receiver)"""
        self.log(f"🔔 INTERRUPT from {address} (seq={seq_no})", "int")
        self.stats["interrupts"] += 1
        self.update_stats()
        
        # GUI updates
        self.gui_queue.put(("update_int_indicator", f"🔔 {address}", True))
        self.gui_queue.put(("update_last_int", f"Last interrupt: Address {address} at {datetime.now().strftime('%H:%M:%S')}"))
        
        # บันทึกประวัติ
        self.interrupt_history.append({
            'time': datetime.now().strftime("%H:%M:%S"),
            'address': address,
            'seq': seq_no,
            'acked': False,
            'raw': raw_data.hex() if raw_data else ""
        })
        self.gui_queue.put(("update_interrupt",))
        
        # ส่ง ACK
        self.send_ack(seq_no)
        
        # เรียก callback
        for cb in self.interrupt_callbacks:
            try:
                cb(address, seq_no)
            except Exception as e:
                self.log(f"Callback error: {e}", "error")
    
    def send_ack(self, seq):
        """ส่ง ACK สำหรับ interrupt ผ่าน main socket โดยไม่แย่ง recv"""
        ack_frame = b'\x02' + seq.encode() + b'0001O\x03'
        self.log(f"Sending ACK (seq={seq})", "info")

        with self._socket_lock:
            if not self._main_socket:
                self.log("ACK skipped: main socket not connected", "warn")
                return False
            try:
                self._main_socket.sendall(ack_frame)
            except Exception as e:
                self.log(f"ACK failed: {e}", "error")
                return False

        self.stats["acks"] += 1
        self.update_stats()
        self._mark_interrupt_acked(seq)
        return True
    
    def connect_ptl(self):
        """สร้าง persistent connection"""
        with self._socket_lock:
            if self._main_socket:
                self.disconnect_ptl()
            
            try:
                self._main_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._main_socket.settimeout(1)
                self._main_socket.connect((self.host.get(), self.port.get()))
                self._clear_response_queue()
                self.gui_queue.put(("update_conn_status", "● Connected", "green"))
                self.log("Connected to PTL (persistent connection)", "ok")
                
                # Start receiver thread
                self.start_receiver()
                return True
            except Exception as e:
                self.log(f"Connection failed: {e}", "error")
                self.gui_queue.put(("update_conn_status", "● Disconnected", "red"))
                return False
    
    def disconnect_ptl(self):
        """ปิด connection"""
        self._receiver_running = False
        with self._socket_lock:
            if self._main_socket:
                try:
                    self._main_socket.shutdown(socket.SHUT_RDWR)
                except:
                    pass
                try:
                    self._main_socket.close()
                except:
                    pass
                self._main_socket = None
        self.gui_queue.put(("update_conn_status", "● Disconnected", "red"))
        self.log("Disconnected from PTL", "info")
    
    def start_receiver(self):
        """เริ่ม thread สำหรับรับข้อมูล"""
        if self._receiver_thread and self._receiver_thread.is_alive():
            return

        self._receiver_running = True
        
        def receiver():
            self.log("Receiver thread started", "info")
            while self._receiver_running:
                sock = self._main_socket
                if not sock:
                    break
                try:
                    data = sock.recv(4096)
                    if data:
                        self.process_incoming_data(data)
                except socket.timeout:
                    continue
                except socket.error as e:
                    if self._receiver_running:
                        self.log(f"Socket error in receiver: {e}", "error")
                        # Attempt reconnect
                        self.gui_queue.put(("update_conn_status", "● Reconnecting...", "orange"))
                        time.sleep(1)
                        self.connect_ptl()
                    break
                except Exception as e:
                    if self._receiver_running:
                        self.log(f"Receiver error: {e}", "error")
                    break
            self.log("Receiver thread stopped", "info")
        
        self._receiver_thread = threading.Thread(target=receiver, daemon=True)
        self._receiver_thread.start()
    
    def process_incoming_data(self, data):
        """ประมวลผลข้อมูลที่ได้รับ"""
        if len(data) < 9:
            return
        
        try:
            seq_no = data[1:4].decode() if len(data) > 4 else "000"
            data_part = data[8:-1] if len(data) > 9 else b''
            data_str = data_part.decode('ascii', errors='replace')
            
            # Check for interrupt
            if 't' in data_str:
                t_idx = data_str.find('t')
                address = data_str[t_idx+1:t_idx+5] if t_idx+5 <= len(data_str) else "????"
                
                # Handle interrupt (will send ACK and update GUI)
                self.handle_interrupt(seq_no, address, data)
            elif self._get_pending_command_seq() == seq_no:
                self._response_queue.put(data)
            else:
                self.log(f"Out-of-band data: {data.hex()}", "info")
        except Exception as e:
            self.log(f"Process error: {e}", "error")
    
    def _build_frame(self, cmd):
        stx, etx = b'\x02', b'\x03'
        with self._lock:
            seq = f"{self._seq:03d}"
        length = f"{len(cmd):04d}"
        return stx + seq.encode() + length.encode() + cmd.encode() + etx
    
    def send_command(self, cmd, timeout=10, retry=2, show_log=True):
        with self._command_lock:
            if show_log:
                self.log(f"Cmd: {cmd}", "info")
                with self._lock:
                    seq_text = f"{self._seq:03d}"
                self.log(f"Seq={seq_text}, Len={len(cmd)}", "info")
            
            # Ensure connection
            if not self._main_socket or not self._receiver_running:
                if not self.connect_ptl():
                    self.log("Cannot send: not connected", "error")
                    return False
            
            for attempt in range(retry + 1):
                self._clear_response_queue()
                frame = self._build_frame(cmd)
                cmd_seq = frame[1:4].decode()
                self._set_pending_command_seq(cmd_seq)
                
                with self._socket_lock:
                    if not self._main_socket:
                        self._clear_pending_command_seq()
                        return False
                    try:
                        self._main_socket.sendall(frame)
                    except Exception as e:
                        self._clear_pending_command_seq()
                        self.log(f"Send error: {e}", "error")
                        self.disconnect_ptl()
                        return False

                try:
                    resp = self._response_queue.get(timeout=timeout)
                except queue.Empty:
                    self._clear_pending_command_seq()
                    self.log(f"Attempt {attempt+1}: Timeout", "warn")
                    self.stats["timeout"] += 1
                    if attempt < retry:
                        time.sleep(1)
                        continue
                    self.stats["fail"] += 1
                    self.update_stats()
                    return False
                
                if resp:
                    self._clear_pending_command_seq()
                    self.log(f"Response: {resp.hex()}", "info")
                    
                    if len(resp) > 8:
                        data_part = resp[8:-1]
                        data_str = data_part.decode('ascii', errors='replace')
                        
                        # Handle interrupt during command
                        if 't' in data_str:
                            t_idx = data_str.find('t')
                            addr = data_str[t_idx+1:t_idx+5] if t_idx+5 <= len(data_str) else "????"
                            seq_in_resp = resp[1:4].decode() if len(resp) > 4 else "000"
                            
                            self.log(f"⚠️ INTERRUPT from {addr} during command", "int")
                            self.send_ack(seq_in_resp)
                            time.sleep(0.5)
                            
                            if attempt < retry:
                                self.log(f"Retrying (attempt {attempt+2})...", "info")
                                continue
                            else:
                                self.stats["fail"] += 1
                                self.update_stats()
                                return False
                        
                        # Success
                        elif 'o' in data_str:
                            self.log(f"✓ SUCCESS", "ok")
                            self._advance_seq()
                            self.stats["sent"] += 1
                            self.stats["ok"] += 1
                            self.update_stats()
                            return True
                        
                        # Error
                        elif 'n' in data_str:
                            self.log(f"✗ Command error", "error")
                            self._advance_seq()
                            self.stats["fail"] += 1
                            self.update_stats()
                            return False
                
                if attempt < retry:
                    time.sleep(1)
                    continue
                
                self.stats["fail"] += 1
                self.update_stats()
                return False
            
            return False
    
    def send_manual(self):
        cmd = self.cmd_entry.get().strip()
        if not cmd:
            return
        try:
            to = int(self.timeout_entry.get())
            rt = int(self.retry_entry.get())
        except:
            self.log("Invalid timeout/retry", "error")
            return
        
        def do_send():
            self.gui_queue.put(("update_status", "Sending..."))
            self.send_command(cmd, to, rt)
            self.gui_queue.put(("update_status", "Ready"))
        
        threading.Thread(target=do_send, daemon=True).start()
    
    def send_selected(self):
        sel = self.tree.selection()
        if not sel:
            return
        vals = self.tree.item(sel[0])['values']
        
        def do_send():
            self.gui_queue.put(("update_status", f"Sending: {vals[0]}"))
            self.send_command(vals[1], int(vals[3]), int(vals[4]))
            self.gui_queue.put(("update_status", "Ready"))
        
        threading.Thread(target=do_send, daemon=True).start()
    
    def start_listener(self):
        self.connect_ptl()
    
    def stop_listener(self):
        self.disconnect_ptl()
    
    def on_closing(self):
        self._receiver_running = False
        self.disconnect_ptl()
        self.root.destroy()
    
    # Command list management
    def add_cmd(self):
        d = tk.Toplevel(self.root)
        d.title("Add Command")
        d.geometry("500x280")
        
        ttk.Label(d, text="Name:").pack(pady=(10,0))
        n = ttk.Entry(d, width=50)
        n.pack(pady=5)
        ttk.Label(d, text="Command:").pack(pady=(10,0))
        c = ttk.Entry(d, width=50)
        c.pack(pady=5)
        ttk.Label(d, text="Description:").pack(pady=(10,0))
        dsc = ttk.Entry(d, width=50)
        dsc.pack(pady=5)
        
        f = ttk.Frame(d)
        f.pack(pady=10)
        ttk.Label(f, text="Timeout:").pack(side=tk.LEFT)
        to = ttk.Entry(f, width=6)
        to.insert(0, "10")
        to.pack(side=tk.LEFT, padx=5)
        ttk.Label(f, text="Retry:").pack(side=tk.LEFT, padx=(10,0))
        rt = ttk.Entry(f, width=4)
        rt.insert(0, "2")
        rt.pack(side=tk.LEFT, padx=5)
        
        def save():
            if n.get() and c.get():
                self.commands.append(CommandItem(n.get(), c.get(), dsc.get(), int(to.get()), int(rt.get())))
                self.refresh_list()
                d.destroy()
        ttk.Button(d, text="Save", command=save).pack(pady=10)
    
    def edit_cmd(self):
        sel = self.tree.selection()
        if not sel:
            return
        idx = self.tree.index(sel[0])
        cmd = self.commands[idx]
        
        d = tk.Toplevel(self.root)
        d.title("Edit Command")
        d.geometry("500x280")
        
        ttk.Label(d, text="Name:").pack(pady=(10,0))
        n = ttk.Entry(d, width=50)
        n.insert(0, cmd.name)
        n.pack(pady=5)
        ttk.Label(d, text="Command:").pack(pady=(10,0))
        c = ttk.Entry(d, width=50)
        c.insert(0, cmd.command)
        c.pack(pady=5)
        ttk.Label(d, text="Description:").pack(pady=(10,0))
        dsc = ttk.Entry(d, width=50)
        dsc.insert(0, cmd.description)
        dsc.pack(pady=5)
        
        f = ttk.Frame(d)
        f.pack(pady=10)
        ttk.Label(f, text="Timeout:").pack(side=tk.LEFT)
        to = ttk.Entry(f, width=6)
        to.insert(0, str(cmd.timeout))
        to.pack(side=tk.LEFT, padx=5)
        ttk.Label(f, text="Retry:").pack(side=tk.LEFT, padx=(10,0))
        rt = ttk.Entry(f, width=4)
        rt.insert(0, str(cmd.retry))
        rt.pack(side=tk.LEFT, padx=5)
        
        def save():
            self.commands[idx] = CommandItem(n.get(), c.get(), dsc.get(), int(to.get()), int(rt.get()))
            self.refresh_list()
            d.destroy()
        ttk.Button(d, text="Save", command=save).pack(pady=10)
    
    def del_cmd(self):
        sel = self.tree.selection()
        if sel and messagebox.askyesno("Confirm", "Delete?"):
            idx = self.tree.index(sel[0])
            del self.commands[idx]
            self.refresh_list()
    
    def save_cmds(self):
        fn = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON","*.json")])
        if fn:
            with open(fn, 'w') as f:
                json.dump([asdict(c) for c in self.commands], f, indent=2)
            self.log(f"Saved {len(self.commands)} commands", "ok")

    def import_from_excel(self):
        """นำเข้าคำสั่งจากไฟล์ Excel"""
        file_path = filedialog.askopenfilename(
            title="เลือกไฟล์ Excel",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")]
        )

        if not file_path:
            return

        try:
            df = pd.read_excel(file_path)

            required_cols = ["name", "command"]
            missing_cols = [col for col in required_cols if col not in df.columns]

            if missing_cols:
                if len(df.columns) >= 2:
                    df["name"] = df.iloc[:, 0]
                    df["command"] = df.iloc[:, 1]
                    if len(df.columns) >= 3:
                        df["description"] = df.iloc[:, 2]
                    if len(df.columns) >= 4:
                        df["timeout"] = df.iloc[:, 3]
                    if len(df.columns) >= 5:
                        df["retry"] = df.iloc[:, 4]
                    self.log("ใช้การแมปอัตโนมัติ: คอลัมน์ 1=Name, 2=Command, 3=Desc, 4=Timeout, 5=Retry", "info")
                else:
                    messagebox.showerror(
                        "Error",
                        "ไฟล์ Excel ต้องมีอย่างน้อย 2 คอลัมน์ (Name และ Command)\n"
                        f"คอลัมน์ที่มี: {list(df.columns)}"
                    )
                    return

            new_commands = []
            skipped = 0

            for _, row in df.iterrows():
                name = str(row.get("name", "")).strip()
                command = str(row.get("command", "")).strip()

                if not name or not command or name == "nan" or command == "nan":
                    skipped += 1
                    continue

                description = ""
                if pd.notna(row.get("description")):
                    description = str(row.get("description", "")).strip()
                    if description == "nan":
                        description = ""

                timeout = 10
                retry = 2

                if "timeout" in df.columns and pd.notna(row.get("timeout")):
                    try:
                        timeout = int(row["timeout"])
                    except Exception:
                        timeout = 10

                if "retry" in df.columns and pd.notna(row.get("retry")):
                    try:
                        retry = int(row["retry"])
                    except Exception:
                        retry = 2

                new_commands.append(CommandItem(
                    name=name,
                    command=command,
                    description=description,
                    timeout=timeout,
                    retry=retry,
                ))

            if not new_commands:
                messagebox.showwarning("Warning", "ไม่พบข้อมูลที่ถูกต้องในไฟล์ Excel")
                return

            if self.commands:
                replace_existing = messagebox.askyesno(
                    "Import Options",
                    f"พบคำสั่งเดิม {len(self.commands)} รายการ\n"
                    f"นำเข้า {len(new_commands)} รายการใหม่\n\n"
                    "YES = แทนที่ทั้งหมด\n"
                    "NO = เพิ่มต่อท้าย"
                )
                if replace_existing:
                    self.commands = new_commands
                else:
                    self.commands.extend(new_commands)
            else:
                self.commands = new_commands

            self.refresh_list()
            msg = f"นำเข้าสำเร็จ: {len(new_commands)} คำสั่ง"
            if skipped > 0:
                msg += f" (ข้าม {skipped} แถวว่าง)"
            self.log(msg, "ok")
            messagebox.showinfo("Success", msg)
        except Exception as e:
            error_msg = f"นำเข้า Excel ล้มเหลว: {e}"
            self.log(error_msg, "error")
            messagebox.showerror("Import Error", error_msg)

    def export_to_excel(self):
        """ส่งออกรายการคำสั่งไป Excel"""
        if not self.commands:
            messagebox.showwarning("Warning", "ไม่มีคำสั่งให้ส่งออก")
            return

        file_path = filedialog.asksaveasfilename(
            title="บันทึกไฟล์ Excel",
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx"), ("All files", "*.*")]
        )

        if not file_path:
            return

        try:
            data = []
            for cmd in self.commands:
                data.append({
                    "name": cmd.name,
                    "command": cmd.command,
                    "description": cmd.description,
                    "timeout": cmd.timeout,
                    "retry": cmd.retry,
                })

            df = pd.DataFrame(data)
            df.to_excel(file_path, index=False, sheet_name="PTL_Commands")

            self.log(f"ส่งออก {len(self.commands)} คำสั่งไปยัง {file_path}", "ok")
            messagebox.showinfo("Success", f"ส่งออก {len(self.commands)} คำสั่งเรียบร้อย")
        except Exception as e:
            error_msg = f"ส่งออก Excel ล้มเหลว: {e}"
            self.log(error_msg, "error")
            messagebox.showerror("Export Error", error_msg)
    
    def load_cmds(self):
        fn = filedialog.askopenfilename(filetypes=[("JSON","*.json")])
        if fn:
            with open(fn, 'r') as f:
                data = json.load(f)
            self.commands = [CommandItem(**d) for d in data]
            self.refresh_list()
            self.log(f"Loaded {len(self.commands)} commands", "ok")
    
    def refresh_list(self):
        for item in self.tree.get_children():
            self.tree.delete(item)
        for cmd in self.commands:
            self.tree.insert("", tk.END, values=(cmd.name, cmd.command, cmd.description, cmd.timeout, cmd.retry))
    
    def load_sample_commands(self):
        self.commands = [
            CommandItem("Display 456", "PP5050000m111#0001  456", "Show 456 at #0001", 10, 2),
            CommandItem("Display 123", "PP5050000m111#0001  123", "Show 123 at #0001", 10, 2),
            CommandItem("Clear #0001", "PP5050000m111#0001     ", "Clear display", 10, 2),
            CommandItem("Maintenance", "A", "System maintenance", 60, 1),
        ]
        self.refresh_list()
    
    def run_all(self):
        if not self.commands:
            return
        self.stop_flag = False
        
        def run():
            self.log("="*40, "info")
            self.log("Starting batch...", "info")
            for i, cmd in enumerate(self.commands):
                if self.stop_flag:
                    break
                self.log(f"[{i+1}/{len(self.commands)}] {cmd.name}", "info")
                self.send_command(cmd.command, cmd.timeout, cmd.retry)
                time.sleep(0.3)
            self.log("Batch complete", "ok")
        
        self.stop_flag = False
        threading.Thread(target=run, daemon=True).start()
    
    def stop_run(self):
        self.stop_flag = True
        self.log("Stopping batch...", "warn")


def main():
    root = tk.Tk()
    app = PTLController(root)
    root.mainloop()


if __name__ == "__main__":
    main()
