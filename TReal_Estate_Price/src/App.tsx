/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Papa from "papaparse";
import { 
  Search, 
  MapPin, 
  Building2, 
  Filter, 
  ArrowUpDown, 
  Info, 
  X,
  ChevronRight,
  Home,
  DollarSign,
  Maximize2,
  Calendar
} from "lucide-react";
import { CITIES, TRANSACTION_TYPES, CITY_DISTRICTS } from "./constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface Transaction {
  district: string; // 鄉鎮市區
  transactionType: string; // 交易標的
  address: string; // 土地位置建物門牌
  area: string; // 土地移轉總面積平方公尺
  zoning: string; // 都市土地使用分區
  date: string; // 交易年月日
  content: string; // 交易筆棟數
  floor: string; // 移轉層次
  totalFloor: string; // 總樓層數
  buildingType: string; // 建物型態
  mainUse: string; // 主要用途
  material: string; // 主要建材
  completionDate: string; // 建築完成年月
  buildingArea: string; // 建物移轉總面積平方公尺
  rooms: string; // 建物現況格局-房
  halls: string; // 建物現況格局-廳
  bathrooms: string; // 建物現況格局-衛
  hasPartition: string; // 建物現況格局-隔間
  hasManagement: string; // 有無管理組織
  totalPrice: string; // 總價元
  unitPrice: string; // 單價元/平方公尺
  parkingType: string; // 車位類別
  parkingArea: string; // 車位移轉總面積平方公尺
  parkingPrice: string; // 車位總價元
  remarks: string; // 備註
  id: string; // 編號
}

export default function App() {
  const [cityName, setCityName] = useState("臺北市");
  const [typeName, setTypeName] = useState("買賣");
  const [district, setDistrict] = useState("全部");
  const [search, setSearch] = useState("");
  
  const [propertyTypes, setPropertyTypes] = useState<string[]>(["土地"]);
  const [period, setPeriod] = useState({ startY: "101", startM: "1", endY: "115", endM: "12" });
  const [unitPrice, setUnitPrice] = useState({ min: "", max: "", unit: "1" }); // 1:萬元/坪, 2:元/㎡
  const [area, setArea] = useState({ min: "", max: "", unit: "2" }); // 1:㎡, 2:坪
  const [age, setAge] = useState({ min: "", max: "" });
  
  const [data, setData] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Transaction | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Transaction; direction: "asc" | "desc" } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = React.useRef(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const YEARS = Array.from({ length: 15 }, (_, i) => (101 + i).toString());
  const MONTHS = Array.from({ length: 12 }, (_, i) => (1 + i).toString());

  const [dataSource, setDataSource] = useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    // Abort any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);
    setDataSource(null);
    try {
      const cityCode = CITIES.find(c => c.name === cityName)?.code || "A";
      const typeCode = TRANSACTION_TYPES.find(t => t.name === typeName)?.code || "A";
      
      const response = await fetch(`/api/proxy-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          cityCode,
          district,
          propertyTypes,
          transactionType: typeCode,
          period,
          unitPrice,
          area,
          age,
          keyword: search
        })
      });

      if (!response.ok) {
        let errorMsg = "無法從官方來源取得資料";
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          try {
            const errData = await response.json();
            errorMsg = errData.error || errorMsg;
          } catch (e) {
            errorMsg = `伺服器錯誤 (${response.status})`;
          }
        } else {
          errorMsg = `伺服器連線異常 (${response.status})，請檢查網路或稍後再試。`;
        }
        throw new Error(errorMsg);
      }
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("伺服器傳回非預期的資料格式，請稍後再試。");
      }

      const result = await response.json();
      setDataSource(result.source);
      
      // If we got CSV data back (either intercepted or mock fallback)
      if (result.isCsv || (result.rawData && result.rawData.includes('鄉鎮市區'))) {
        Papa.parse(result.rawData, {
          header: false,
          complete: (parsed) => {
            const rows = parsed.data as string[][];
            if (rows.length < 3) {
              setData([]);
              setLoading(false);
              return;
            }

            const mappedData: Transaction[] = rows.slice(2).filter(row => row.length > 1).map((row, index) => ({
              district: row[0],
              transactionType: row[1],
              address: row[2],
              area: row[3],
              zoning: row[4],
              date: row[7],
              content: row[8],
              floor: row[9],
              totalFloor: row[10],
              buildingType: row[11],
              mainUse: row[12],
              material: row[13],
              completionDate: row[14],
              buildingArea: row[15],
              rooms: row[16],
              halls: row[17],
              bathrooms: row[18],
              hasPartition: row[19],
              hasManagement: row[20],
              totalPrice: row[21],
              unitPrice: row[22],
              parkingType: row[23],
              parkingArea: row[24],
              parkingPrice: row[25],
              remarks: row[26],
              id: row[27] || `item-${index}`,
            }));
            
            setData(mappedData);
            setLoading(false);
          },
        });
      } else if (result.data && Array.isArray(result.data)) {
        // DOM-extracted rows
        const tableId: string = result.tableId || 'bizList_table';

        const mapBizRow = (row: string[], index: number): Transaction => ({
          district: "",
          transactionType: row[9] || "",
          address: row[0] || "",
          area: row[4] || "",
          zoning: "",
          date: row[2] || "",
          content: row[10] || "",
          floor: row[8] || "",
          totalFloor: "",
          buildingType: row[6] || "",
          mainUse: "",
          material: "",
          completionDate: "",
          buildingArea: row[4] || "",
          rooms: row[11] || "",
          halls: "",
          bathrooms: "",
          hasPartition: "",
          hasManagement: row[13] || "",
          totalPrice: row[1] || "",
          unitPrice: row[3] || "",
          parkingType: "",
          parkingArea: "",
          parkingPrice: row[12] || "",
          remarks: row[16] || "",
          id: `item-${index}`,
        });

        const mapSaleRow = (row: string[], index: number): Transaction => ({
          district: row[1] || "",
          transactionType: row[8] || "",
          address: row[0] || "",
          area: row[5] || "",
          zoning: "",
          date: row[3] || "",
          content: row[9] || "",
          floor: row[7] || "",
          totalFloor: "",
          buildingType: row[6] || "",
          mainUse: row[12] || "",
          material: row[13] || "",
          completionDate: "",
          buildingArea: row[5] || "",
          rooms: row[10] || "",
          halls: "",
          bathrooms: "",
          hasPartition: "",
          hasManagement: "",
          totalPrice: row[2] || "",
          unitPrice: row[4] || "",
          parkingType: "",
          parkingArea: "",
          parkingPrice: row[11] || "",
          remarks: row[14] || "",
          id: `item-${index}`,
        });

        const mapRentRow = (row: string[], index: number): Transaction => ({
          district: "",
          transactionType: "",
          address: row[0] || "",
          area: row[3] || "",
          zoning: "",
          date: row[2] || "",
          content: row[4] || "",
          floor: row[5] || "",
          totalFloor: "",
          buildingType: row[6] || "",
          mainUse: "",
          material: "",
          completionDate: "",
          buildingArea: row[3] || "",
          rooms: row[7] || "",
          halls: "",
          bathrooms: "",
          hasPartition: "",
          hasManagement: row[8] || "",
          totalPrice: row[1] || "",
          unitPrice: "",
          parkingType: "",
          parkingArea: "",
          parkingPrice: "",
          remarks: row[9] || "",
          id: `item-${index}`,
        });

        const mapRow = tableId === 'bizList_table'  ? mapBizRow
                     : tableId === 'saleList_table' ? mapSaleRow
                     : mapRentRow;

        const mappedData: Transaction[] = result.data.map(mapRow);
        setData(mappedData);
        setLoading(false);
      } else {
        setData([]);
        setLoading(false);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Request was intentionally cancelled (e.g. React StrictMode remount) — ignore silently
        return;
      }
      console.error("Fetch error details:", error);
      setError(error.message || "發生網路錯誤，請稍後再試。");
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, [cityName, typeName, district, propertyTypes, period, unitPrice, area, age, search]);


  useEffect(() => {
    // Cleanup only: abort any in-flight request when component unmounts.
    // fetchData is NOT called here — query only starts when the user clicks the button.
    return () => {
      abortControllerRef.current?.abort();
      isFetchingRef.current = false;
    };
  }, []); // Only on mount

  const uniqueDistricts = useMemo(() => {
    return ["全部", ...(CITY_DISTRICTS[cityName] || []).map(d => d.name)];
  }, [cityName]);

  const filteredData = useMemo(() => {
    let result = data.filter((item) => {
      // Basic Search
      const matchesSearch = search === "" || item.address.includes(search) || item.district.includes(search) || item.buildingType.includes(search);
      
      // District Filter
      const matchesDistrict = district === "全部" || item.district === district;

      // Property Type Filter
      const matchesPropertyType = propertyTypes.length === 0 || propertyTypes.some(pt => {
        if (pt === "房地") return item.transactionType === "房地(土地+建物)";
        if (pt === "房地(車)") return item.transactionType === "房地(土地+建物)+車位";
        return item.transactionType === pt;
      });

      // Period Filter
      let matchesPeriod = true;
      if (item.date && item.date.length >= 6) {
        const itemY = parseInt(item.date.substring(0, item.date.length - 4));
        const itemM = parseInt(item.date.substring(item.date.length - 4, item.date.length - 2));
        const startY = parseInt(period.startY);
        const startM = parseInt(period.startM);
        const endY = parseInt(period.endY);
        const endM = parseInt(period.endM);
        
        const itemDateVal = itemY * 12 + itemM;
        const startDateVal = startY * 12 + startM;
        const endDateVal = endY * 12 + endM;
        
        matchesPeriod = itemDateVal >= startDateVal && itemDateVal <= endDateVal;
      }

      // Unit Price Filter
      let matchesUnitPrice = true;
      if (unitPrice.min !== "" || unitPrice.max !== "") {
        const priceVal = parseFloat(item.unitPrice) || 0;
        let comparePrice = priceVal;
        if (unitPrice.unit === "1") { // 萬元/坪
          comparePrice = (priceVal * 3.30578) / 10000;
        }
        const min = parseFloat(unitPrice.min);
        const max = parseFloat(unitPrice.max);
        if (!isNaN(min) && comparePrice < min) matchesUnitPrice = false;
        if (!isNaN(max) && comparePrice > max) matchesUnitPrice = false;
      }

      // Area Filter
      let matchesArea = true;
      if (area.min !== "" || area.max !== "") {
        const areaVal = parseFloat(item.area) || 0;
        let compareArea = areaVal;
        if (area.unit === "2") { // 坪
          compareArea = areaVal * 0.3025;
        }
        const min = parseFloat(area.min);
        const max = parseFloat(area.max);
        if (!isNaN(min) && compareArea < min) matchesArea = false;
        if (!isNaN(max) && compareArea > max) matchesArea = false;
      }

      // Age Filter
      let matchesAge = true;
      if (age.min !== "" || age.max !== "") {
        if (!item.completionDate) {
          matchesAge = false;
        } else {
          const compY = parseInt(item.completionDate.substring(0, item.completionDate.length - 4));
          const currentY = new Date().getFullYear() - 1911;
          const itemAge = currentY - compY;
          
          const min = parseFloat(age.min);
          const max = parseFloat(age.max);
          if (!isNaN(min) && itemAge < min) matchesAge = false;
          if (!isNaN(max) && itemAge > max) matchesAge = false;
        }
      }

      return matchesSearch && matchesDistrict && matchesPropertyType && matchesPeriod && matchesUnitPrice && matchesArea && matchesAge;
    });

    if (sortConfig) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        // Handle numeric sorting for price and area
        if (["totalPrice", "unitPrice", "buildingArea", "area"].includes(sortConfig.key)) {
          const aNum = parseFloat(aValue as string) || 0;
          const bNum = parseFloat(bValue as string) || 0;
          return sortConfig.direction === "asc" ? aNum - bNum : bNum - aNum;
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, search, sortConfig, district, propertyTypes, period, unitPrice, area, age]);

  const handleSort = (key: keyof Transaction) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const formatPrice = (price: string) => {
    const p = parseFloat(price);
    if (isNaN(p)) return price;
    if (p >= 10000) {
      return `${(p / 10000).toFixed(2)} 萬`;
    }
    return `${p} 元`;
  };

  const formatDate = (dateStr: string) => {
    if (dateStr.length === 7) {
      const year = parseInt(dateStr.substring(0, 3)) + 1911;
      const month = dateStr.substring(3, 5);
      const day = dateStr.substring(5, 7);
      return `${year}/${month}/${day}`;
    }
    return dateStr;
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-emerald-50">
      {/* Background Blobs */}
      <div className="absolute top-0 -left-4 w-96 h-96 bg-emerald-400 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
      <div className="absolute top-0 -right-4 w-96 h-96 bg-lime-400 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
      <div className="absolute -bottom-8 left-20 w-96 h-96 bg-teal-400 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      <div className="absolute inset-0 bg-emerald-50/40 backdrop-blur-[100px]"></div>

      {/* Main Container - Full Bleed */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative w-full h-full glass flex flex-col overflow-hidden border-none rounded-none"
      >
        {/* Header */}
        <div className="p-6 border-b border-emerald-100 flex flex-col gap-6 bg-white/20">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Building2 className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">不動產實價查詢</h1>
                <p className="text-xs text-emerald-600/60 font-medium uppercase tracking-wider">Real Estate Price Explorer</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button 
                onClick={fetchData} 
                disabled={loading}
                className="glass-button rounded-xl"
              >
                {loading ? "更新中..." : "重新整理"}
              </Button>
            </div>
          </div>

          {/* Filters Grid */}
          <div className="grid grid-cols-1 gap-4 bg-white/30 p-4 rounded-2xl border border-white/50">
            
            {/* Row 1: Location & Search */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1.5 w-32">
                <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">縣市</label>
                <select className="w-full glass-input border-none text-slate-900 h-9 px-3 rounded-lg outline-none" value={cityName} onChange={e => { setCityName(e.target.value); setDistrict("全部"); }}>
                  {CITIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 w-32">
                <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">鄉鎮市區</label>
                <select className="w-full glass-input border-none text-slate-900 h-9 px-3 rounded-lg outline-none" value={district} onChange={e => setDistrict(e.target.value)}>
                  {uniqueDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 w-32">
                <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">交易類型</label>
                <select className="w-full glass-input border-none text-slate-900 h-9 px-3 rounded-lg outline-none" value={typeName} onChange={e => setTypeName(e.target.value)}>
                  {TRANSACTION_TYPES.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 flex-1 min-w-[200px]">
                <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">門牌 / 社區名稱 / 地段</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600/40" />
                  <input 
                    type="text"
                    placeholder="請輸入關鍵字..." 
                    className="w-full pl-9 glass-input border-none text-slate-900 placeholder:text-emerald-900/30 h-9 rounded-lg outline-none"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Property Types */}
            <div className="flex flex-wrap gap-4 items-center py-2 border-y border-emerald-100/50">
              <span className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest">標的種類</span>
              {["房地", "房地(車)", "建物", "車位", "土地"].map(pt => (
                <label key={pt} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" className="accent-emerald-500 w-4 h-4" 
                    checked={propertyTypes.includes(pt)}
                    onChange={(e) => {
                      if (e.target.checked) setPropertyTypes([...propertyTypes, pt]);
                      else setPropertyTypes(propertyTypes.filter(p => p !== pt));
                    }}
                  />
                  <span className="text-sm text-slate-700 font-medium">{pt}</span>
                </label>
              ))}
            </div>

            {/* Row 3: Advanced Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Period */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">交易期間</label>
                <div className="flex items-center gap-1">
                  <select className="glass-input border-none text-slate-900 h-8 px-1 rounded outline-none" value={period.startY} onChange={e => setPeriod({...period, startY: e.target.value})}>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <span className="text-slate-500 text-xs">年</span>
                  <select className="glass-input border-none text-slate-900 h-8 px-1 rounded outline-none" value={period.startM} onChange={e => setPeriod({...period, startM: e.target.value})}>
                    {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <span className="text-slate-500 text-xs">月</span>
                  <span className="text-slate-400 mx-1">-</span>
                  <select className="glass-input border-none text-slate-900 h-8 px-1 rounded outline-none" value={period.endY} onChange={e => setPeriod({...period, endY: e.target.value})}>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <span className="text-slate-500 text-xs">年</span>
                  <select className="glass-input border-none text-slate-900 h-8 px-1 rounded outline-none" value={period.endM} onChange={e => setPeriod({...period, endM: e.target.value})}>
                    {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <span className="text-slate-500 text-xs">月</span>
                </div>
              </div>

              {/* Unit Price */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">單價</label>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="up_unit" checked={unitPrice.unit==="1"} onChange={()=>setUnitPrice({...unitPrice, unit:"1"})} className="accent-emerald-500"/> 萬元/坪</label>
                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="up_unit" checked={unitPrice.unit==="2"} onChange={()=>setUnitPrice({...unitPrice, unit:"2"})} className="accent-emerald-500"/> 元/㎡</label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" placeholder="最小值" className="w-full glass-input border-none text-slate-900 h-8 px-2 rounded outline-none" value={unitPrice.min} onChange={e=>setUnitPrice({...unitPrice, min: e.target.value})} />
                  <span className="text-slate-400">-</span>
                  <input type="number" placeholder="最大值" className="w-full glass-input border-none text-slate-900 h-8 px-2 rounded outline-none" value={unitPrice.max} onChange={e=>setUnitPrice({...unitPrice, max: e.target.value})} />
                </div>
              </div>

              {/* Area */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">面積</label>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="a_unit" checked={area.unit==="1"} onChange={()=>setArea({...area, unit:"1"})} className="accent-emerald-500"/> ㎡</label>
                    <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="a_unit" checked={area.unit==="2"} onChange={()=>setArea({...area, unit:"2"})} className="accent-emerald-500"/> 坪</label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" placeholder="最小值" className="w-full glass-input border-none text-slate-900 h-8 px-2 rounded outline-none" value={area.min} onChange={e=>setArea({...area, min: e.target.value})} />
                  <span className="text-slate-400">-</span>
                  <input type="number" placeholder="最大值" className="w-full glass-input border-none text-slate-900 h-8 px-2 rounded outline-none" value={area.max} onChange={e=>setArea({...area, max: e.target.value})} />
                </div>
              </div>

              {/* Age */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-emerald-800/60 font-bold uppercase tracking-widest ml-1">屋齡 (年)</label>
                <div className="flex items-center gap-2 mt-[22px]">
                  <input type="number" placeholder="最小值" className="w-full glass-input border-none text-slate-900 h-8 px-2 rounded outline-none" value={age.min} onChange={e=>setAge({...age, min: e.target.value})} />
                  <span className="text-slate-400">-</span>
                  <input type="number" placeholder="最大值" className="w-full glass-input border-none text-slate-900 h-8 px-2 rounded outline-none" value={age.max} onChange={e=>setAge({...age, max: e.target.value})} />
                </div>
              </div>
            </div>

            {/* Row 4: Search Button */}
            <div className="flex justify-end items-center gap-3 mt-2">
              <Button 
                variant="ghost" 
                onClick={() => {
                  setSearch("");
                  setDistrict("全部");
                  setPropertyTypes(["土地"]);
                  setPeriod({ startY: "101", startM: "1", endY: "115", endM: "12" });
                  setUnitPrice({ min: "", max: "", unit: "1" });
                  setArea({ min: "", max: "", unit: "2" });
                  setAge({ min: "", max: "" });
                }}
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100/50 rounded-xl"
              >
                清除篩選
              </Button>
              <Button 
                onClick={fetchData} 
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-8 shadow-lg shadow-emerald-600/20"
              >
                <Search className="w-4 h-4 mr-2" />
                {loading ? "查詢中..." : "查詢資料"}
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading ? (
            <div className="p-6 space-y-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-12 w-full bg-emerald-900/5 rounded-xl" />
                </div>
              ))}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader className="sticky top-0 bg-emerald-50/80 backdrop-blur-md z-10">
                  <TableRow className="border-emerald-100 hover:bg-transparent">
                    <TableHead className="text-emerald-900/60 font-medium">
                      <Button variant="ghost" className="hover:bg-emerald-100 text-emerald-900/60 p-0 h-auto" onClick={() => handleSort("district")}>
                        地區 <ArrowUpDown className="ml-2 w-3 h-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-emerald-900/60 font-medium">位置/社區</TableHead>
                    <TableHead className="text-emerald-900/60 font-medium">
                      <Button variant="ghost" className="hover:bg-emerald-100 text-emerald-900/60 p-0 h-auto" onClick={() => handleSort("date")}>
                        交易日期 <ArrowUpDown className="ml-2 w-3 h-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-emerald-900/60 font-medium">型態</TableHead>
                    <TableHead className="text-emerald-900/60 font-medium text-right">
                      <Button variant="ghost" className="hover:bg-emerald-100 text-emerald-900/60 p-0 h-auto ml-auto" onClick={() => handleSort("totalPrice")}>
                        總價 <ArrowUpDown className="ml-2 w-3 h-3" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-emerald-900/60 font-medium text-right">單價/坪</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence mode="popLayout">
                    {filteredData.map((item) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        key={item.id} 
                        className="border-emerald-50 hover:bg-emerald-500/5 cursor-pointer group transition-colors"
                        onClick={() => setSelectedItem(item)}
                      >
                        <TableCell className="text-slate-900 font-medium">{item.district}</TableCell>
                        <TableCell className="max-w-[200px]">
                          <div className="truncate text-slate-700 group-hover:text-slate-900 transition-colors">{item.address}</div>
                          <div className="text-[10px] text-emerald-800/40 mt-0.5">{item.transactionType}</div>
                        </TableCell>
                        <TableCell className="text-slate-600">{formatDate(item.date)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-emerald-500/5 border-emerald-200 text-emerald-700 font-normal">
                            {item.buildingType.split("(")[0] || "土地"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-emerald-600 font-bold">
                          {formatPrice(item.totalPrice)}
                        </TableCell>
                        <TableCell className="text-right text-slate-500">
                          {item.unitPrice ? `${(parseFloat(item.unitPrice) * 3.30578 / 10000).toFixed(1)} 萬` : "-"}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="w-4 h-4 text-emerald-200 group-hover:text-emerald-500 transition-colors" />
                        </TableCell>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </TableBody>
              </Table>
              {filteredData.length === 0 && !loading && !error && (
                <div className="flex flex-col items-center justify-center py-20 text-emerald-900/20">
                  <Info className="w-12 h-12 mb-4 opacity-20" />
                  <p>未找到符合條件的資料</p>
                </div>
              )}
              {error && (
                <div className="flex flex-col items-center justify-center py-20 text-red-500/60">
                  <X className="w-12 h-12 mb-4 opacity-40" />
                  <p className="text-sm font-medium mb-2">資料讀取失敗</p>
                  <p className="text-xs opacity-60 max-w-md text-center">{error}</p>
                  <Button 
                    variant="outline" 
                    className="mt-6 glass-button border-red-500/20 text-red-600"
                    onClick={fetchData}
                  >
                    重新嘗試
                  </Button>
                </div>
              )}
            </ScrollArea>
          )}
        </div>

        {/* Footer Info */}
        <div className="p-4 border-t border-emerald-100 bg-emerald-500/5 flex items-center justify-between text-[10px] text-emerald-800/40">
          <div className="flex items-center gap-4">
            <span>資料來源：內政部不動產成交案件實際資訊</span>
            <span>更新頻率：每 10 日更新</span>
            {dataSource && (
              <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-200 bg-emerald-50">
                官方即時資料
              </Badge>
            )}
            <span className="text-emerald-600 font-bold">當前顯示：{filteredData.length} 筆資料</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>系統連線正常</span>
          </div>
        </div>
      </motion.div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="glass border-emerald-200 text-slate-900 max-w-2xl rounded-3xl overflow-hidden p-0">
          {selectedItem && (
            <div className="flex flex-col">
              <div className="p-6 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-b border-emerald-100">
                <DialogHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">
                      {selectedItem.district}
                    </Badge>
                    <Badge variant="outline" className="border-emerald-200 text-emerald-800/60">
                      {selectedItem.transactionType}
                    </Badge>
                  </div>
                  <DialogTitle className="text-2xl font-bold text-slate-900 leading-tight">
                    {selectedItem.address}
                  </DialogTitle>
                </DialogHeader>
              </div>

              <ScrollArea className="max-h-[60vh]">
                <div className="p-6 space-y-8">
                  {/* Key Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="glass p-4 rounded-2xl flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-emerald-800/40 text-[10px] uppercase tracking-wider">
                        <DollarSign className="w-3 h-3" /> 總價
                      </div>
                      <div className="text-lg font-bold text-emerald-600">{formatPrice(selectedItem.totalPrice)}</div>
                    </div>
                    <div className="glass p-4 rounded-2xl flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-emerald-800/40 text-[10px] uppercase tracking-wider">
                        <Maximize2 className="w-3 h-3" /> 面積
                      </div>
                      <div className="text-lg font-bold text-slate-900">{selectedItem.buildingArea || selectedItem.area} ㎡</div>
                      <div className="text-[10px] text-emerald-800/30">約 {(parseFloat(selectedItem.buildingArea || selectedItem.area) * 0.3025).toFixed(2)} 坪</div>
                    </div>
                    <div className="glass p-4 rounded-2xl flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-emerald-800/40 text-[10px] uppercase tracking-wider">
                        <Home className="w-3 h-3" /> 型態
                      </div>
                      <div className="text-sm font-bold text-slate-900 truncate">{selectedItem.buildingType.split("(")[0] || "土地"}</div>
                    </div>
                    <div className="glass p-4 rounded-2xl flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-emerald-800/40 text-[10px] uppercase tracking-wider">
                        <Calendar className="w-3 h-3" /> 交易日
                      </div>
                      <div className="text-sm font-bold text-slate-900">{formatDate(selectedItem.date)}</div>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-emerald-800/40 uppercase tracking-widest px-1">詳細資訊</h3>
                    <div className="glass rounded-2xl overflow-hidden divide-y divide-emerald-100">
                      <DetailRow label="建物型態" value={selectedItem.buildingType || "土地"} />
                      <DetailRow label="移轉層次" value={selectedItem.floor ? `${selectedItem.floor} / ${selectedItem.totalFloor}` : "-"} />
                      <DetailRow label="主要用途" value={selectedItem.mainUse || "-"} />
                      <DetailRow label="主要建材" value={selectedItem.material || "-"} />
                      <DetailRow label="建築完成日" value={formatDate(selectedItem.completionDate)} />
                      <DetailRow label="現況格局" value={selectedItem.rooms ? `${selectedItem.rooms} 房 / ${selectedItem.halls} 廳 / ${selectedItem.bathrooms} 衛` : "-"} />
                      <DetailRow label="管理組織" value={selectedItem.hasManagement || "-"} />
                      <DetailRow label="車位類別" value={selectedItem.parkingType || "無"} />
                      <DetailRow label="車位總價" value={formatPrice(selectedItem.parkingPrice)} />
                    </div>
                  </div>

                  {/* Remarks */}
                  {selectedItem.remarks && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold text-emerald-800/40 uppercase tracking-widest px-1">備註</h3>
                      <div className="glass p-4 rounded-2xl text-sm text-slate-600 leading-relaxed italic">
                        "{selectedItem.remarks}"
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-emerald-100 flex justify-end">
                <Button 
                  onClick={() => setSelectedItem(null)}
                  className="glass-button rounded-xl px-8"
                >
                  關閉
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-4 text-sm">
      <span className="text-emerald-800/40">{label}</span>
      <span className="text-slate-900 font-medium">{value || "-"}</span>
    </div>
  );
}
