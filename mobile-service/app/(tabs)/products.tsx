import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  Modal, ScrollView, TouchableWithoutFeedback,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
import { listProducts } from '../../src/api/products'
import { listCategories } from '../../src/api/categories'
import { listBrands } from '../../src/api/brands'
import TopNav from '../../src/components/layout/TopNav'
import ProductCard from '../../src/components/product/ProductCard'
import Spinner from '../../src/components/ui/Spinner'
import type { Category, Brand } from '../../src/types'


const SORT_OPTIONS = [
  { label: 'Default',          sort: '',           order: '' },
  { label: 'Newest First',     sort: 'created_at', order: 'desc' },
  { label: 'Name A–Z',         sort: 'name',       order: 'asc' },
  { label: 'Price: Low → High', sort: 'base_price', order: 'asc' },
  { label: 'Price: High → Low', sort: 'base_price', order: 'desc' },
]

export default function ProductsScreen() {
  const { search: searchParam } = useLocalSearchParams<{ search?: string }>()
  const searchInputRef = useRef<TextInput>(null)

  const [search, setSearch] = useState(searchParam || '')
  const [debouncedSearch, setDebouncedSearch] = useState(searchParam || '')
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)

  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedBrand, setSelectedBrand] = useState<string>('')
  const [selectedSort, setSelectedSort] = useState(SORT_OPTIONS[0])

  const [pendingCategory, setPendingCategory] = useState<string>('')
  const [pendingBrand, setPendingBrand] = useState<string>('')
  const [pendingSort, setPendingSort] = useState(SORT_OPTIONS[0])

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (searchParam) {
      setSearch(searchParam)
      setDebouncedSearch(searchParam)
    }
  }, [searchParam])

  const handleSearch = (text: string) => {
    setSearch(text)
    if (timer) clearTimeout(timer)
    const t = setTimeout(() => { setDebouncedSearch(text); setPage(1) }, 500)
    setTimer(t)
  }

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    staleTime: 5 * 60 * 1000,
  })

  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: listBrands,
    staleTime: 5 * 60 * 1000,
  })

  const allCategories: Category[] = categoriesData || []
  const parents = allCategories
    .filter((c) => c.parent_category_id === null)
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999))
  const childrenByParent: Record<string, Category[]> = {}
  allCategories.filter((c) => c.parent_category_id !== null).forEach((c) => {
    const pid = c.parent_category_id!
    if (!childrenByParent[pid]) childrenByParent[pid] = []
    childrenByParent[pid].push(c)
  })

  const brands: Brand[] = brandsData || []

  const { data, isLoading } = useQuery({
    queryKey: ['products', 'list', debouncedSearch, selectedCategory, selectedBrand, selectedSort.sort, selectedSort.order, page],
    queryFn: () => listProducts({
      search: debouncedSearch,
      category: selectedCategory || undefined,
      brand: selectedBrand || undefined,
      sort: selectedSort.sort || undefined,
      order: selectedSort.order || undefined,
      page,
    }),
  })

  const products = data?.products || []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  const activeFilterCount =
    (selectedCategory ? 1 : 0) +
    (selectedBrand ? 1 : 0) +
    (selectedSort !== SORT_OPTIONS[0] ? 1 : 0)

  const openFilter = () => {
    setPendingCategory(selectedCategory)
    setPendingBrand(selectedBrand)
    setPendingSort(selectedSort)
    setFilterOpen(true)
  }

  const applyFilters = () => {
    setSelectedCategory(pendingCategory)
    setSelectedBrand(pendingBrand)
    setSelectedSort(pendingSort)
    setPage(1)
    setFilterOpen(false)
  }

  const clearFilters = () => {
    setPendingCategory('')
    setPendingBrand('')
    setPendingSort(SORT_OPTIONS[0])
  }

  const resetAll = () => {
    setSelectedCategory('')
    setSelectedBrand('')
    setSelectedSort(SORT_OPTIONS[0])
    setPage(1)
  }

  const selectedCategoryName = selectedCategory
    ? allCategories.find((c) => c.slug === selectedCategory)?.name
    : null
  const selectedBrandName = selectedBrand
    ? brands.find((b) => b.id === selectedBrand)?.name
    : null

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <TopNav onSearchPress={() => searchInputRef.current?.focus()} />

      <View className="bg-white dark:bg-[#24252f] border-b border-gray-100 dark:border-[#3f4150] px-4 pt-3 pb-2">
        <View className="flex-row items-center justify-between mb-2">
          <View>
            <Text className="text-2xl font-extrabold text-gray-900 dark:text-gray-100" style={{ fontStyle: 'italic' }} numberOfLines={1}>
              All Products
            </Text>
            {total > 0 && (
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {total} product{total !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
        </View>

        <View className="flex-row gap-2">
          <View className="flex-1 flex-row items-center bg-gray-50 dark:bg-[#1a1b23] rounded-xl px-3 py-2.5 border border-gray-200 dark:border-[#3f4150]">
            <Ionicons name="search-outline" size={18} color="#9CA3AF" />
            <TextInput
              ref={searchInputRef}
              value={search}
              onChangeText={handleSearch}
              placeholder="Search products..."
              placeholderTextColor="#9CA3AF"
              className="flex-1 ml-2 text-gray-900 dark:text-gray-100 text-sm"
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => { setSearch(''); setDebouncedSearch(''); setPage(1) }}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            onPress={openFilter}
            className={`flex-row items-center gap-1.5 px-3.5 rounded-xl border ${
              activeFilterCount > 0
                ? 'bg-accent-500 border-accent-500'
                : 'bg-gray-50 dark:bg-[#1a1b23] border-gray-200 dark:border-[#3f4150]'
            }`}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={activeFilterCount > 0 ? '#fff' : '#6B7280'}
            />
            <Text className={`text-sm font-semibold ${activeFilterCount > 0 ? 'text-white' : 'text-gray-600 dark:text-gray-400'}`}>
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {activeFilterCount > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2" contentContainerStyle={{ gap: 6 }}>
            {selectedCategoryName && (
              <TouchableOpacity
                onPress={() => { setSelectedCategory(''); setPage(1) }}
                className="flex-row items-center gap-1 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-full px-3 py-1"
              >
                <Text className="text-accent-700 dark:text-accent-400 text-xs font-medium">{selectedCategoryName}</Text>
                <Ionicons name="close" size={12} color="#7cb900" />
              </TouchableOpacity>
            )}
            {selectedBrandName && (
              <TouchableOpacity
                onPress={() => { setSelectedBrand(''); setPage(1) }}
                className="flex-row items-center gap-1 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-full px-3 py-1"
              >
                <Text className="text-accent-700 dark:text-accent-400 text-xs font-medium">{selectedBrandName}</Text>
                <Ionicons name="close" size={12} color="#7cb900" />
              </TouchableOpacity>
            )}
            {selectedSort !== SORT_OPTIONS[0] && (
              <TouchableOpacity
                onPress={() => { setSelectedSort(SORT_OPTIONS[0]); setPage(1) }}
                className="flex-row items-center gap-1 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-full px-3 py-1"
              >
                <Text className="text-accent-700 dark:text-accent-400 text-xs font-medium">{selectedSort.label}</Text>
                <Ionicons name="close" size={12} color="#7cb900" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={resetAll}
              className="flex-row items-center gap-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full px-3 py-1"
            >
              <Text className="text-red-600 dark:text-red-400 text-xs font-medium">Clear All</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {isLoading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="search-outline" size={56} color="#9CA3AF" />
          <Text className="text-gray-900 dark:text-gray-100 mt-3 text-base font-bold">No products found</Text>
          <Text className="text-gray-400 text-sm mt-1 text-center">Try adjusting your search or filters</Text>
          {activeFilterCount > 0 && (
            <TouchableOpacity onPress={resetAll} className="mt-4 bg-accent-500 px-6 py-2.5 rounded-xl">
              <Text className="text-white font-semibold text-sm">Clear Filters</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 12, paddingBottom: 8 }}
          columnWrapperStyle={{ gap: 12, marginBottom: 12 }}
          renderItem={({ item }) => (
            <View style={{ width: '47.5%' }}>
              <ProductCard product={item} />
            </View>
          )}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            totalPages > 1 ? (
              <View className="flex-row items-center justify-center gap-2 py-4">
                <TouchableOpacity
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className={`flex-row items-center gap-1 px-4 py-2.5 rounded-xl border ${
                    page === 1
                      ? 'border-gray-200 dark:border-[#3f4150] opacity-40'
                      : 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                  }`}
                >
                  <Ionicons name="chevron-back" size={16} color={page === 1 ? '#9CA3AF' : '#7cb900'} />
                  <Text className={`text-sm font-semibold ${page === 1 ? 'text-gray-400' : 'text-accent-600 dark:text-accent-400'}`}>
                    Prev
                  </Text>
                </TouchableOpacity>

                <View className="flex-row items-center gap-1">
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 5) {
                      pageNum = i + 1
                    } else if (page <= 3) {
                      pageNum = i + 1
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i
                    } else {
                      pageNum = page - 2 + i
                    }
                    return (
                      <TouchableOpacity
                        key={pageNum}
                        onPress={() => setPage(pageNum)}
                        className={`w-9 h-9 rounded-xl items-center justify-center border ${
                          pageNum === page
                            ? 'bg-accent-500 border-accent-500'
                            : 'border-gray-200 dark:border-[#3f4150] bg-white dark:bg-[#24252f]'
                        }`}
                      >
                        <Text className={`text-sm font-bold ${pageNum === page ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                          {pageNum}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>

                <TouchableOpacity
                  onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className={`flex-row items-center gap-1 px-4 py-2.5 rounded-xl border ${
                    page === totalPages
                      ? 'border-gray-200 dark:border-[#3f4150] opacity-40'
                      : 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                  }`}
                >
                  <Text className={`text-sm font-semibold ${page === totalPages ? 'text-gray-400' : 'text-accent-600 dark:text-accent-400'}`}>
                    Next
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={page === totalPages ? '#9CA3AF' : '#7cb900'} />
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {/* Filter bottom sheet */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setFilterOpen(false)}>
          <View className="flex-1 bg-black/50 justify-end">
            <TouchableWithoutFeedback>
              <View className="bg-white dark:bg-[#24252f] rounded-t-2xl" style={{ maxHeight: '85%' }}>
                <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-[#3f4150]">
                  <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">Filters & Sort</Text>
                  <View className="flex-row items-center gap-3">
                    <TouchableOpacity onPress={clearFilters}>
                      <Text className="text-accent-600 dark:text-accent-400 text-sm font-semibold">Clear</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setFilterOpen(false)}>
                      <Ionicons name="close" size={22} color="#6B7280" />
                    </TouchableOpacity>
                  </View>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>

                  {/* Sort */}
                  <View className="px-5 pt-4 pb-2">
                    <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Sort By</Text>
                    <View className="gap-2">
                      {SORT_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt.label}
                          onPress={() => setPendingSort(opt)}
                          className={`flex-row items-center justify-between px-4 py-3 rounded-xl border ${
                            pendingSort.label === opt.label
                              ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                              : 'border-gray-200 dark:border-[#3f4150] bg-gray-50 dark:bg-[#1a1b23]'
                          }`}
                        >
                          <Text className={`text-sm font-medium ${
                            pendingSort.label === opt.label
                              ? 'text-accent-700 dark:text-accent-400'
                              : 'text-gray-700 dark:text-gray-300'
                          }`}>
                            {opt.label}
                          </Text>
                          {pendingSort.label === opt.label && (
                            <Ionicons name="checkmark-circle" size={18} color="#7cb900" />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Categories */}
                  {parents.length > 0 && (
                    <View className="px-5 pt-4 pb-2 border-t border-gray-100 dark:border-[#3f4150] mt-2">
                      <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Category</Text>

                      <TouchableOpacity
                        onPress={() => setPendingCategory('')}
                        className={`flex-row items-center justify-between px-4 py-3 rounded-xl border mb-2 ${
                          pendingCategory === ''
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                            : 'border-gray-200 dark:border-[#3f4150] bg-gray-50 dark:bg-[#1a1b23]'
                        }`}
                      >
                        <Text className={`text-sm font-medium ${pendingCategory === '' ? 'text-accent-700 dark:text-accent-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          All Categories
                        </Text>
                        {pendingCategory === '' && <Ionicons name="checkmark-circle" size={18} color="#7cb900" />}
                      </TouchableOpacity>

                      {parents.map((cat) => {
                        const children = childrenByParent[cat.id] || []
                        const expanded = expandedCategories[cat.id]
                        const isSelected = pendingCategory === cat.slug || children.some((c) => c.slug === pendingCategory)

                        return (
                          <View key={cat.id} className="mb-1">
                            <View className="flex-row items-center gap-2">
                              <TouchableOpacity
                                onPress={() => setPendingCategory(cat.slug)}
                                className={`flex-1 flex-row items-center justify-between px-4 py-3 rounded-xl border ${
                                  pendingCategory === cat.slug
                                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                                    : isSelected
                                    ? 'border-accent-300 dark:border-accent-700 bg-accent-50/50 dark:bg-accent-900/10'
                                    : 'border-gray-200 dark:border-[#3f4150] bg-gray-50 dark:bg-[#1a1b23]'
                                }`}
                              >
                                <Text className={`text-sm font-medium ${
                                  pendingCategory === cat.slug
                                    ? 'text-accent-700 dark:text-accent-400'
                                    : 'text-gray-700 dark:text-gray-300'
                                }`}>
                                  {cat.name}
                                </Text>
                                {pendingCategory === cat.slug && <Ionicons name="checkmark-circle" size={18} color="#7cb900" />}
                              </TouchableOpacity>
                              {children.length > 0 && (
                                <TouchableOpacity
                                  onPress={() => setExpandedCategories((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                                  className="w-10 h-10 items-center justify-center"
                                >
                                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
                                </TouchableOpacity>
                              )}
                            </View>

                            {expanded && children.length > 0 && (
                              <View className="ml-4 mt-1 gap-1">
                                {children.map((sub) => (
                                  <TouchableOpacity
                                    key={sub.id}
                                    onPress={() => setPendingCategory(sub.slug)}
                                    className={`flex-row items-center justify-between px-4 py-2.5 rounded-xl border ${
                                      pendingCategory === sub.slug
                                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                                        : 'border-gray-200 dark:border-[#3f4150] bg-gray-50 dark:bg-[#1a1b23]'
                                    }`}
                                  >
                                    <Text className={`text-sm ${
                                      pendingCategory === sub.slug
                                        ? 'text-accent-700 dark:text-accent-400 font-medium'
                                        : 'text-gray-600 dark:text-gray-400'
                                    }`}>
                                      {sub.name}
                                    </Text>
                                    {pendingCategory === sub.slug && <Ionicons name="checkmark-circle" size={18} color="#7cb900" />}
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}
                          </View>
                        )
                      })}
                    </View>
                  )}

                  {/* Brands */}
                  {brands.length > 0 && (
                    <View className="px-5 pt-4 pb-2 border-t border-gray-100 dark:border-[#3f4150] mt-2">
                      <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Brand</Text>

                      <TouchableOpacity
                        onPress={() => setPendingBrand('')}
                        className={`flex-row items-center justify-between px-4 py-3 rounded-xl border mb-2 ${
                          pendingBrand === ''
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                            : 'border-gray-200 dark:border-[#3f4150] bg-gray-50 dark:bg-[#1a1b23]'
                        }`}
                      >
                        <Text className={`text-sm font-medium ${pendingBrand === '' ? 'text-accent-700 dark:text-accent-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          All Brands
                        </Text>
                        {pendingBrand === '' && <Ionicons name="checkmark-circle" size={18} color="#7cb900" />}
                      </TouchableOpacity>

                      {brands.map((brand) => (
                        <TouchableOpacity
                          key={brand.id}
                          onPress={() => setPendingBrand(brand.id)}
                          className={`flex-row items-center justify-between px-4 py-3 rounded-xl border mb-1 ${
                            pendingBrand === brand.id
                              ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                              : 'border-gray-200 dark:border-[#3f4150] bg-gray-50 dark:bg-[#1a1b23]'
                          }`}
                        >
                          <Text className={`text-sm font-medium ${
                            pendingBrand === brand.id
                              ? 'text-accent-700 dark:text-accent-400'
                              : 'text-gray-700 dark:text-gray-300'
                          }`}>
                            {brand.name}
                          </Text>
                          {pendingBrand === brand.id && <Ionicons name="checkmark-circle" size={18} color="#7cb900" />}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </ScrollView>

                <View className="px-5 pt-3 pb-6 border-t border-gray-100 dark:border-[#3f4150]">
                  <TouchableOpacity
                    onPress={applyFilters}
                    className="bg-accent-500 py-4 rounded-xl items-center"
                  >
                    <Text className="text-white font-bold text-base">Apply Filters</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  )
}
